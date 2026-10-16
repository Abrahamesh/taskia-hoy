import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TaskiaLoad, TaskiaTask } from '../types'

const PANE = 'taskia-hoy'
const SERVER = 'MCP_TASKIA'
const TOOL = 'agent_what_to_do_today'
const MAX = 30
const GROUPS = ['Urgente hoy', 'Vencida reciente', 'En curso', 'Vieja / revisar si sigue']
// Nombre corto de cada grupo para la fila de conteos del resumen.
const SHORT: Record<string, string> = {
  'Urgente hoy': 'urgentes',
  'Vencida reciente': 'vencidas',
  'En curso': 'en curso',
  'Vieja / revisar si sigue': 'viejas',
}
// Al abrir el panel solo se despliegan las vencidas; el resto se abre con un clic.
const OPEN_BY_DEFAULT = ['Vencida reciente']

const tasks = atom({ plugin: 'taskia-hoy', key: 'tasks' } as const, [] as TaskiaTask[])
const load = atom({ plugin: 'taskia-hoy', key: 'load' } as const, 'idle' as TaskiaLoad)
const error = atom({ plugin: 'taskia-hoy', key: 'error' } as const, '')
const updatedAt = atom({ plugin: 'taskia-hoy', key: 'updatedAt' } as const, '')
const brief = atom({ plugin: 'taskia-hoy', key: 'brief' } as const, '')
const open = atom({ plugin: 'taskia-hoy', key: 'open' } as const, OPEN_BY_DEFAULT as string[])

type Raw = {
  task_ref: string
  name: string
  workspace_name?: string
  estimatedduedate?: string
  status?: string
  accomplishment?: number
  priority?: string
  urgency?: string
}

const today = () => new Date().toISOString().slice(0, 10)
const day = (s?: string) => (s ? s.slice(0, 10) : '')

// "hoy", "hace 3d", "hace 4m", "en 2d": más corto que la fecha completa.
function relDue(due: string): string {
  if (!due) return ''
  const d = Math.round((Date.parse(today()) - Date.parse(due)) / 86400000)
  if (d === 0) return 'hoy'
  if (d < 0) return `en ${-d}d`
  return d > 60 ? `hace ${Math.round(d / 30)}m` : `hace ${d}d`
}

function fallbackGroup(t: Raw): string {
  const due = day(t.estimatedduedate)
  if (!due) return 'En curso'
  if (due === today()) return 'Urgente hoy'
  const ageDays = (Date.parse(today()) - Date.parse(due)) / 86400000
  return ageDays > 60 ? 'Vieja / revisar si sigue' : 'Vencida reciente'
}

// El nombre del servidor cambia según dónde esté conectado Taskia (en la app de
// escritorio es un ID), así que se busca entre las herramientas de la sesión.
async function taskiaServers($: any): Promise<string[]> {
  const suffix = `__${TOOL}`
  const found = (await $.tool.list())
    .map((t: any) => String(t.name))
    .filter((n: string) => n.startsWith('mcp__') && n.endsWith(suffix))
    .map((n: string) => n.slice('mcp__'.length, -suffix.length))
  return found.length > 0 ? found : [SERVER]
}

async function fetchTasks($: any): Promise<Raw[]> {
  let lastErr: unknown = new Error('Taskia no está conectado en esta sesión')
  for (const server of await taskiaServers($)) {
    try {
      const res = await $.mcp.call(server, TOOL, { limit: 50, include_overdue: true })
      if (res.isError) throw new Error('Taskia respondió con error')
      const text = res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
      const data = JSON.parse(text)
      return (data.items ?? []) as Raw[]
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr
}

// Lo que sale del modelo: el resumen del día y la clasificación de cada tarea.
// Si el modelo no responde o responde mal, quedan los grupos por fecha y sin resumen.
async function classify($: any, raw: Raw[]): Promise<{ list: TaskiaTask[]; brief: string }> {
  const base: TaskiaTask[] = raw.slice(0, MAX).map(t => ({
    ref: String(t.task_ref),
    name: t.name,
    workspace: t.workspace_name ?? '',
    due: day(t.estimatedduedate),
    status: t.status ?? '',
    group: fallbackGroup(t),
    summary: '',
    advice: '',
    canDo: false,
  }))
  if (base.length === 0) return { list: base, brief: '' }

  const prompt =
    `Hoy es ${today()}. Clasifica estas tareas de Taskia de un consultor de automatización (n8n, Power BI, Odoo, M365, agentes IA).\n` +
    `Grupos válidos: ${GROUPS.join(' | ')}.\n` +
    `Devuelve SOLO un objeto JSON, sin texto extra, con esta forma:\n` +
    `{"brief": "...", "tasks": [{"ref", "group", "summary", "advice", "canDo"}]}\n` +
    `- brief: máx 25 palabras, en tono directo, qué es lo más importante hoy y por dónde empezar.\n` +
    `- summary: máx 12 palabras, qué es la tarea.\n` +
    `- advice: máx 12 palabras, qué hacer ya.\n` +
    `- canDo: true si un asistente con acceso a n8n, Power BI, Odoo, documentos y correo puede avanzarla solo.\n\n` +
    JSON.stringify(raw.slice(0, MAX).map(t => ({
      ref: t.task_ref, name: t.name, ws: t.workspace_name, due: day(t.estimatedduedate),
      status: t.status, pct: t.accomplishment, prio: t.priority, urg: t.urgency,
    })))

  const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 4000, effort: 'low', timeoutMs: 45000 })
  if (!r.isAnswered) return { list: base, brief: '' }
  try {
    // Normalmente llega el objeto; si el modelo devuelve solo la lista, se acepta igual.
    const text: string = r.text
    const brace = text.indexOf('{')
    const bracket = text.indexOf('[')
    const isList = bracket >= 0 && (brace < 0 || bracket < brace)
    const obj = isList
      ? { tasks: JSON.parse(text.slice(bracket, text.lastIndexOf(']') + 1)) }
      : JSON.parse(text.slice(brace, text.lastIndexOf('}') + 1))
    const out: any[] = obj.tasks ?? []
    const byRef = new Map(out.map(o => [String(o.ref), o]))
    const list = base.map(t => {
      const o = byRef.get(t.ref)
      if (!o) return t
      return {
        ...t,
        group: GROUPS.includes(o.group) ? o.group : t.group,
        summary: String(o.summary ?? ''),
        advice: String(o.advice ?? ''),
        canDo: o.canDo === true,
      }
    })
    return { list, brief: typeof obj.brief === 'string' ? obj.brief : '' }
  } catch {
    return { list: base, brief: '' }
  }
}

async function refresh($: any) {
  await update($, load, () => 'loading' as TaskiaLoad)
  try {
    const raw = await fetchTasks($)
    const { list, brief: text } = await classify($, raw)
    await update($, tasks, () => list)
    await update($, brief, () => text)
    await update($, updatedAt, () => new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }))
    await update($, load, () => 'ready' as TaskiaLoad)
  } catch (err) {
    await update($, error, () => String((err as Error)?.message ?? err))
    await update($, load, () => 'error' as TaskiaLoad)
  }
}

function toggle($: any, group: string) {
  return update($, open, (cur: string[]) => (cur.includes(group) ? cur.filter(g => g !== group) : [...cur, group]))
}

function startPrompt(t: TaskiaTask): string {
  return (
    `Vamos a trabajar la tarea de Taskia #${t.ref} "${t.name}" (workspace ${t.workspace}).\n` +
    `1) Léela completa con agent_get_task, sus comentarios (agent_list_task_comments) y subtareas si tiene.\n` +
    `2) Dime en 2-3 líneas qué entiendes y el plan.\n` +
    `3) Si la puedes ejecutar con las herramientas conectadas, arráncala; si no, prepárame lo que necesito.\n` +
    `4) Al terminar o pausar, deja un comentario de avance en la tarea con agent_add_task_comment.`
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'taskia', description: 'Abre el panel de tareas de Taskia y lo recarga' })
    void $.ui.open({ id: PANE, title: 'Taskia · Hoy' })
    void refresh($)
    return next(e)
  })

  on('command.run', { command: 'taskia' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Taskia · Hoy' })
    void refresh($)
    return { text: 'Cargando tus tareas de Taskia…' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, load)
    const list = await read($, tasks)
    const err = await read($, error)
    const at = await read($, updatedAt)
    const summary = await read($, brief)
    const opened = await read($, open)

    const groups = GROUPS.map(g => ({ g, items: list.filter(t => t.group === g) })).filter(x => x.items.length > 0)
    const doable = list.filter(t => t.canDo).length

    return (
      <Box flexDirection="column" gap={1}>
        {/* Encabezado: estado y recarga en una sola línea */}
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text dimColor size="caption">
            {state === 'loading' ? 'Cargando y clasificando…' : at ? `${list.length} tareas · ${at}` : ''}
          </Text>
          <Button key="reload" label="↻ Recargar" dimColor onPress={() => void refresh($)} />
        </Box>

        {state === 'error' && <Text color="red">No pude leer Taskia: {err}</Text>}
        {state === 'ready' && list.length === 0 && <Text>Nada pendiente para hoy.</Text>}

        {/* Resumen del día */}
        {list.length > 0 && (
          <Box flexDirection="column">
            {summary !== '' && <Text>{summary}</Text>}
            <Text dimColor size="caption">
              {groups.map(x => `${x.items.length} ${SHORT[x.g]}`).join(' · ')}
              {doable > 0 ? ` · ▶ ${doable} las puedo hacer yo` : ''}
            </Text>
          </Box>
        )}

        {/* Grupos plegables */}
        {groups.map(({ g, items }) => {
          const isOpen = opened.includes(g)
          return (
            <Box key={`box-${g}`} flexDirection="column">
              <Button key={`g-${g}`} plain onPress={() => void toggle($, g)}>
                {isOpen ? '▾ ' : '▸ '}
                <Text weight="semibold">{g}</Text>
                <Text dimColor> {items.length}</Text>
              </Button>
              {isOpen && (
                <Box flexDirection="column" gap={1}>
                  {items.map(t => (
                    <Box key={`row-${t.ref}`} flexDirection="column">
                      <Button key={`t-${t.ref}`} plain onPress={() => void $.prompt.submit({ text: startPrompt(t) })}>
                        {t.canDo ? '▶ ' : '○ '}{t.name}
                      </Button>
                      <Text dimColor size="caption" wrap="truncate-end">
                        {[t.workspace, relDue(t.due), t.advice !== '' ? `→ ${t.advice}` : ''].filter(Boolean).join(' · ')}
                      </Text>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )
        })}

        {list.length > 0 && <Text dimColor size="caption">▶ la hago yo · ○ te la preparo · clic para empezar</Text>}
      </Box>
    )
  })
}
