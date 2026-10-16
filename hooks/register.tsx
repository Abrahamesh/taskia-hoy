import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TaskiaLoad, TaskiaTask } from '../types'

const PANE = 'taskia-hoy'
const SERVER = 'MCP_TASKIA'
const MAX = 30
const GROUPS = ['Urgente hoy', 'Vencida reciente', 'En curso', 'Vieja / revisar si sigue']

const tasks = atom({ plugin: 'taskia-hoy', key: 'tasks' } as const, [] as TaskiaTask[])
const load = atom({ plugin: 'taskia-hoy', key: 'load' } as const, 'idle' as TaskiaLoad)
const error = atom({ plugin: 'taskia-hoy', key: 'error' } as const, '')
const updatedAt = atom({ plugin: 'taskia-hoy', key: 'updatedAt' } as const, '')

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

function fallbackGroup(t: Raw): string {
  const due = day(t.estimatedduedate)
  if (!due) return 'En curso'
  if (due === today()) return 'Urgente hoy'
  const ageDays = (Date.parse(today()) - Date.parse(due)) / 86400000
  return ageDays > 60 ? 'Vieja / revisar si sigue' : 'Vencida reciente'
}

async function fetchTasks($: any): Promise<Raw[]> {
  const res = await $.mcp.call(SERVER, 'agent_what_to_do_today', { limit: 50, include_overdue: true })
  if (res.isError) throw new Error('Taskia respondió con error')
  const text = res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join('')
  const data = JSON.parse(text)
  return (data.items ?? []) as Raw[]
}

async function classify($: any, raw: Raw[]): Promise<TaskiaTask[]> {
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
  if (base.length === 0) return base

  const prompt =
    `Hoy es ${today()}. Clasifica estas tareas de Taskia de un consultor de automatización (n8n, Power BI, Odoo, M365, agentes IA).\n` +
    `Grupos válidos: ${GROUPS.join(' | ')}.\n` +
    `Para cada una devuelve: ref, group, summary (máx 12 palabras, qué es), advice (máx 15 palabras, qué hacer ya), ` +
    `canDo (true si un asistente con acceso a n8n, Power BI, Odoo, documentos y correo puede avanzarla solo).\n` +
    `Responde SOLO un array JSON, sin texto extra.\n\n` +
    JSON.stringify(raw.slice(0, MAX).map(t => ({
      ref: t.task_ref, name: t.name, ws: t.workspace_name, due: day(t.estimatedduedate),
      status: t.status, pct: t.accomplishment, prio: t.priority, urg: t.urgency,
    })))

  const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 4000, effort: 'low', timeoutMs: 45000 })
  if (!r.isAnswered) return base
  try {
    const json = r.text.slice(r.text.indexOf('['), r.text.lastIndexOf(']') + 1)
    const out = JSON.parse(json) as any[]
    const byRef = new Map(out.map(o => [String(o.ref), o]))
    return base.map(t => {
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
  } catch {
    return base
  }
}

async function refresh($: any) {
  await update($, load, () => 'loading' as TaskiaLoad)
  try {
    const raw = await fetchTasks($)
    const list = await classify($, raw)
    await update($, tasks, () => list)
    await update($, updatedAt, () => new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }))
    await update($, load, () => 'ready' as TaskiaLoad)
  } catch (err) {
    await update($, error, () => String((err as Error)?.message ?? err))
    await update($, load, () => 'error' as TaskiaLoad)
  }
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

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1}>
          <Text dimColor>
            {state === 'loading' ? 'Cargando y clasificando…' : at ? `Actualizado ${at} · ${list.length} tareas` : ''}
          </Text>
          <Button key="reload" label="Recargar" onPress={() => void refresh($)} />
        </Box>
        {state === 'error' && <Text color="red">No pude leer Taskia: {err}</Text>}
        {state === 'ready' && list.length === 0 && <Text>Nada pendiente para hoy.</Text>}
        {GROUPS.filter(g => list.some(t => t.group === g)).map(g => (
          <Box flexDirection="column">
            <Text bold>{g} ({list.filter(t => t.group === g).length})</Text>
            {list.filter(t => t.group === g).map(t => (
              <Box flexDirection="column">
                <Button key={`t-${t.ref}`} onPress={() => void $.prompt.submit({ text: startPrompt(t) })}>
                  {t.canDo ? '▶ ' : '○ '}{t.name} <Text dimColor>#{t.ref} · {t.workspace}{t.due ? ` · ${t.due}` : ''}</Text>
                </Button>
                {t.summary !== '' && <Text dimColor>{t.summary}</Text>}
                {t.advice !== '' && <Text>→ {t.advice}</Text>}
              </Box>
            ))}
          </Box>
        ))}
        <Text dimColor>▶ Claude puede hacerla · ○ solo preparar</Text>
      </Box>
    )
  })
}
