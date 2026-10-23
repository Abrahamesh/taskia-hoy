import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TaskiaKpi, TaskiaLoad, TaskiaTask } from '../types'

const PANE = 'taskia-hoy'
const SEARCH = 'agent_search_tasks'
const CHILDREN = 'agent_list_task_children'
// Nombres que puede tener el conector de Taskia en claude.ai, por preferencia.
const CONNECTORS = ['MCP_TASKIA', 'Taskia']
const CONNECTORS_SERVER = 'ccd_connectors'
const CONNECTORS_TOOL = 'session_connectors_status'
// En modo auto el panel solo puede leer Taskia si estas herramientas están permitidas.
const AUTO_MODE_HELP =
  'el modo auto bloqueó la lectura. Pega esto en el chat: "Agrega a permissions.allow de mi ' +
  `~/.claude/settings.json ${SEARCH} y ${CHILDREN} de mi conector de Taskia (Taskia o MCP_TASKIA, ` +
  'no el de dev) con su ID real, como mcp__<id>__<herramienta>. No borres nada." Luego abre una sesión nueva.'
// Quién usa el panel, de la opción "perfil" del mod; se fija al cargar el módulo.
let profile = ''
// Una tarea con este avance o más ya se da por hecha y no se muestra.
const DONE_PCT = 90
// El avance marca el estado en el flujo del equipo: en 60% la tarea volvió, en 90% se aprobó.
const NEW_PCT = 60
const RETURNED_PCT = 60
const APPROVED_PCT = 90
const KPIS: { id: TaskiaKpi; label: string; test: (pct: number) => boolean }[] = [
  { id: 'pending', label: 'Pendientes', test: p => p < DONE_PCT },
  { id: 'new', label: 'Nuevas', test: p => p < NEW_PCT },
  { id: 'returned', label: 'Devueltas', test: p => p === RETURNED_PCT },
  { id: 'approved', label: 'Aprobadas', test: p => p === APPROVED_PCT },
]
// Clave en $.store de los workspaces elegidos, para recordarlos entre sesiones.
const SELECTED_KEY = 'selected'
// Topes para no hacer demasiadas llamadas a Taskia en cuentas grandes.
const MAX = 60
const MAX_PAGES = 6
const MAX_PARENTS = 60
// Orden dentro de cada workspace: lo que ya está en marcha primero.
const STATUS_ORDER = ['En progreso', 'Por revisar', 'Por hacer', 'Ideas']

const tasks = atom({ plugin: 'taskia-hoy', key: 'tasks' } as const, [] as TaskiaTask[])
const load = atom({ plugin: 'taskia-hoy', key: 'load' } as const, 'idle' as TaskiaLoad)
const error = atom({ plugin: 'taskia-hoy', key: 'error' } as const, '')
const updatedAt = atom({ plugin: 'taskia-hoy', key: 'updatedAt' } as const, '')
const brief = atom({ plugin: 'taskia-hoy', key: 'brief' } as const, '')
// Workspaces que la persona abrió o cerró a mano; de entrada solo el primero está abierto.
const flipped = atom({ plugin: 'taskia-hoy', key: 'flipped' } as const, [] as string[])
// Workspaces elegidos; vacío es todos.
const selected = atom({ plugin: 'taskia-hoy', key: 'selected' } as const, [] as string[])
// KPI que filtra la lista.
const kpi = atom({ plugin: 'taskia-hoy', key: 'kpi' } as const, 'pending' as TaskiaKpi)

type Raw = {
  task_ref: string
  name: string
  workspace_name?: string
  status?: string
  accomplishment?: number
  responsible_name?: string
  has_child_tasks?: boolean
}

const pct = (t: Raw) => (typeof t.accomplishment === 'number' ? Math.max(0, Math.round(t.accomplishment)) : 0)

// Lo que cuenta en el panel: tareas hoja (las que tienen acciones) y no canceladas,
// pendientes (bajo DONE_PCT) o recién aprobadas (en APPROVED_PCT, solo para su KPI).
// El estado de cancelación se llama distinto según el workspace.
const isTracked = (t: Raw) =>
  !t.has_child_tasks && (pct(t) < DONE_PCT || pct(t) === APPROVED_PCT) && !/cancel/i.test(t.status ?? '')

// Posición del nombre en CONNECTORS (sin distinguir mayúsculas), o -1 si no es de Taskia.
const rank = (name: string) => CONNECTORS.findIndex(c => c.toLowerCase() === name.toLowerCase())

// El de mejor posición entre los conectores con nombre de Taskia.
function pick<T>(items: T[], name: (t: T) => string): T | undefined {
  return items.filter(t => rank(name(t)) >= 0).sort((a, b) => rank(name(a)) - rank(name(b)))[0]
}

// Lo conectado en la sesión: el servidor de Taskia y los nombres de los demás
// conectores, que dicen qué tareas puede avanzar el asistente por su cuenta.
// El panel solo lee de un conector llamado exactamente como uno de CONNECTORS.
// Otros con las mismas herramientas (MCP_WEB_TASKIA_DEV, TaskiaDev) se ignoran.
async function sessionConnectors($: any): Promise<{ server?: string; names: string[] }> {
  const servers = new Set<string>(
    (await $.tool.list())
      .map((t: any) => String(t.name))
      .filter((n: string) => n.startsWith('mcp__'))
      .map((n: string) => n.slice('mcp__'.length, n.indexOf('__', 'mcp__'.length))),
  )
  // En la terminal el servidor lleva el nombre del conector (claude_ai_Taskia).
  if (!servers.has(CONNECTORS_SERVER)) {
    const server = pick([...servers], s => s.replace(/^claude_ai_/, ''))
    return { server, names: usefulNames([...servers].map(s => s.replace(/^claude_ai_/, '').replace(/_/g, ' '))) }
  }
  // En la app de escritorio el servidor es un ID: el nombre se busca en la lista de conectores.
  const rows: any[] = ((await callJson($, CONNECTORS_SERVER, CONNECTORS_TOOL, {})).servers ?? [])
    .filter((r: any) => r.status === 'connected')
  const id = pick(rows.filter(r => servers.has(r.id)), r => String(r.name))?.id
  return {
    server: id && servers.has(id) ? String(id) : undefined,
    names: usefulNames(rows.map(r => String(r.name).split(':').pop() ?? '')),
  }
}

// Sin Taskia (ya está en el panel) ni las herramientas internas de la app.
function usefulNames(names: string[]): string[] {
  return [...new Set(names.map(n => n.trim()).filter(n => n !== '' && !/taskia|^ccd /i.test(n)))]
}

async function callJson($: any, server: string, tool: string, args: Record<string, unknown>): Promise<any> {
  const res = await $.mcp.call(server, tool, args)
  if (res.isError) throw new Error(server === CONNECTORS_SERVER ? 'no pude leer la lista de conectores de la app' : 'el conector de Taskia respondió con error')
  return JSON.parse(res.content.map((b: any) => (b.type === 'text' ? b.text : '')).join(''))
}

// Todas las páginas de una búsqueda, hasta MAX_PAGES.
async function searchAll($: any, server: string, args: Record<string, unknown>): Promise<Raw[]> {
  const out: Raw[] = []
  for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
    const data = await callJson($, server, SEARCH, { ...args, limit: 50, offset })
    out.push(...((data.items ?? []) as Raw[]))
    if (!data.pagination?.has_more) break
    offset = data.pagination.next_offset ?? offset + 50
  }
  return out
}

// Taskia no dice de qué tarea cuelga cada una: se recorren los padres de los
// workspaces donde hay tareas pendientes y se arma "Fase › Entregable" por tarea.
// Si algo falla aquí, las tareas se muestran igual, sin ese camino.
async function parentPaths($: any, server: string, pending: Raw[]): Promise<Map<string, string>> {
  const paths = new Map<string, string>()
  try {
    const workspaces = [...new Set(pending.map(t => t.workspace_name ?? '').filter(Boolean))]
    const all = (await Promise.all(workspaces.map(ws =>
      searchAll($, server, { mine: false, workspace: ws }).then(items => items.filter(t => t.workspace_name === ws)),
    ))).flat()
    const names = new Map(all.map(t => [String(t.task_ref), t.name]))
    const parents = all.filter(t => t.has_child_tasks).slice(0, MAX_PARENTS)
    const parentOf = new Map<string, string>()
    await Promise.all(parents.map(async p => {
      const data = await callJson($, server, CHILDREN, { task_ref: String(p.task_ref), workspace: p.workspace_name, limit: 100 })
      for (const c of data.children ?? []) parentOf.set(String(c.task_ref), String(p.task_ref))
    }))
    for (const t of pending) {
      const chain: string[] = []
      for (let ref = parentOf.get(String(t.task_ref)); ref && chain.length < 4; ref = parentOf.get(ref)) {
        chain.unshift(names.get(ref) ?? '')
      }
      if (chain.length > 0) paths.set(String(t.task_ref), chain.filter(Boolean).join(' › '))
    }
  } catch {
    // Sin camino: no impide mostrar las tareas.
  }
  return paths
}

// Al iniciar la sesión los MCP pueden tardar en conectar: se espera hasta ~30 s.
async function fetchTasks($: any): Promise<{ list: TaskiaTask[]; tools: string[] }> {
  let found: { server?: string; names: string[] } = { names: [] }
  for (let i = 0; i < 10 && !found.server; i++) {
    found = await sessionConnectors($)
    if (!found.server) await $.clock.sleep(3000)
  }
  const server = found.server
  if (!server) throw new Error(`no hay un conector llamado ${CONNECTORS.join(' o ')} conectado en esta sesión`)

  const pending = (await searchAll($, server, { mine: true })).filter(isTracked)
  const paths = await parentPaths($, server, pending)

  // Workspaces con más tareas primero; dentro, por estado y luego por avance.
  const count = new Map<string, number>()
  for (const t of pending) count.set(t.workspace_name ?? '', (count.get(t.workspace_name ?? '') ?? 0) + 1)
  const order = (s?: string) => { const i = STATUS_ORDER.indexOf(s ?? ''); return i < 0 ? STATUS_ORDER.length : i }
  pending.sort((a, b) =>
    (count.get(b.workspace_name ?? '') ?? 0) - (count.get(a.workspace_name ?? '') ?? 0) ||
    (a.workspace_name ?? '').localeCompare(b.workspace_name ?? '') ||
    order(a.status) - order(b.status) ||
    pct(b) - pct(a))

  // Todas, para que los KPIs cuenten bien; el modelo solo ve las primeras MAX pendientes.
  const list: TaskiaTask[] = pending.map(t => ({
    ref: String(t.task_ref),
    name: t.name,
    workspace: t.workspace_name || 'Sin workspace',
    path: paths.get(String(t.task_ref)) ?? '',
    status: t.status ?? '',
    pct: pct(t),
    advice: '',
    canDo: false,
  }))
  return { list, tools: found.names }
}

// Lo que sale del modelo: el resumen y, por tarea, qué hacer ya y si Claude puede avanzarla.
// El perfil viene de la opción "perfil"; vacía, el modelo lo deduce de las tareas.
// Si el modelo no responde o responde mal, las tareas quedan sin resumen ni consejo.
async function classify($: any, all: TaskiaTask[], tools: string[]): Promise<{ list: TaskiaTask[]; brief: string }> {
  const base = all.filter(t => t.pct < DONE_PCT).slice(0, MAX)
  if (base.length === 0) return { list: all, brief: '' }

  const prompt =
    `Estas son las tareas pendientes en Taskia de ` +
    (profile !== ''
      ? `esta persona: ${profile}.\n`
      : `una persona cuyo rol no conoces: dedúcelo de los workspaces y los nombres de las tareas.\n`) +
    `Su equipo casi no usa fechas: prioriza por estado, avance y lo que dice cada tarea, no por vencimiento.\n` +
    `"path" es de qué tarea padre viene cada una.\n` +
    `Devuelve SOLO un objeto JSON, sin texto extra, con esta forma:\n` +
    `{"brief": "...", "tasks": [{"ref", "advice", "canDo"}]}\n` +
    `- brief: máx 25 palabras, en tono directo, por dónde empezar y por qué.\n` +
    `- advice: máx 12 palabras, qué hacer ya.\n` +
    `- canDo: true solo si un asistente que lee y escribe archivos y tiene estos conectores puede avanzarla sin la persona: ` +
    `${tools.length > 0 ? tools.join(', ') : 'ninguno'}. Si la tarea pide algo fuera de eso (reuniones, visitas, llamadas, sistemas no conectados), false.\n\n` +
    JSON.stringify(base.map(t => ({ ref: t.ref, name: t.name, ws: t.workspace, path: t.path, status: t.status, pct: t.pct })))

  const r = await $.model.complete({ model: 'haiku', prompt, maxTokens: 4000, effort: 'low', timeoutMs: 45000 })
  if (!r.isAnswered) return { list: all, brief: '' }
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
    const list = all.map(t => {
      const o = byRef.get(t.ref)
      if (!o) return t
      return { ...t, advice: String(o.advice ?? ''), canDo: o.canDo === true }
    })
    return { list, brief: typeof obj.brief === 'string' ? obj.brief : '' }
  } catch {
    return { list: all, brief: '' }
  }
}

async function refresh($: any) {
  await update($, load, () => 'loading' as TaskiaLoad)
  try {
    const { list: base, tools } = await fetchTasks($)
    const { list, brief: text } = await classify($, base, tools)
    await update($, tasks, () => list)
    await update($, brief, () => text)
    await update($, updatedAt, () => new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }))
    await update($, load, () => 'ready' as TaskiaLoad)
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    // En modo auto, una llamada que la persona no pidió se rechaza salvo que esté
    // en su lista de permisos: se dice en español qué agregar.
    await update($, error, () => (/refused|auto mode/i.test(msg) ? AUTO_MODE_HELP : msg))
    await update($, load, () => 'error' as TaskiaLoad)
  }
}

function toggle($: any, ws: string) {
  return update($, flipped, (cur: string[]) => (cur.includes(ws) ? cur.filter(g => g !== ws) : [...cur, ws]))
}

// Marca o desmarca un workspace (null: todos) y lo guarda para la próxima sesión.
async function choose($: any, ws: string | null) {
  await update($, selected, (cur: string[]) => (ws === null ? [] : cur.includes(ws) ? cur.filter(g => g !== ws) : [...cur, ws]))
  await $.store.set(SELECTED_KEY, await read($, selected))
}

function startPrompt(t: TaskiaTask): string {
  return (
    `Quiero trabajar la tarea de Taskia #${t.ref} "${t.name}" (workspace ${t.workspace}` +
    `${t.path ? `, dentro de ${t.path}` : ''}).\n` +
    `NO ejecutes nada todavía: solo lee y propón.\n` +
    `1) Léela completa con agent_get_task, sus comentarios (agent_list_task_comments) y subtareas si tiene.\n` +
    `2) Dime en 2-3 líneas qué entiendes que hay que hacer.\n` +
    `3) Propón el plan en pasos cortos, marcando cuáles puedes hacer tú con las herramientas conectadas y cuáles me tocan a mí.\n` +
    `4) Si algo no está claro, hazme las preguntas concretas (máximo 3) en vez de asumir.\n` +
    `5) Cierra con: "¿Lo ejecuto así, ajusto algo o lo dejamos?" y espera mi respuesta.\n` +
    `Solo cuando yo apruebe, ejecútalo; al terminar o pausar, deja un comentario de avance en la tarea con agent_add_task_comment.`
  )
}

export const register: Register = (on, options) => {
  profile = String(options.perfil ?? '').trim()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'taskia', description: 'Abre el panel de tareas de Taskia y lo recarga' })
    const saved = await $.store.get(SELECTED_KEY)
    if (Array.isArray(saved)) await update($, selected, () => saved.map(String))
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
    const toggled = await read($, flipped)
    const chosen = await read($, selected)
    const filter = await read($, kpi)

    // La lista ya viene ordenada: los workspaces salen en el orden en que aparecen.
    const workspaces = [...new Set(list.map(t => t.workspace))]
    // Los elegidos que siguen teniendo tareas; si no queda ninguno, todos.
    const picked = workspaces.filter(ws => chosen.includes(ws))
    const all = picked.length === 0
    const scoped = all ? list : list.filter(t => picked.includes(t.workspace))
    const test = (KPIS.find(k => k.id === filter) ?? KPIS[0]).test
    const shown = scoped.filter(t => test(t.pct))
    const groups = [...new Set(shown.map(t => t.workspace))].map(ws => ({ ws, items: shown.filter(t => t.workspace === ws) }))
    const doable = shown.filter(t => t.canDo).length
    const pendingCount = list.filter(t => t.pct < DONE_PCT).length

    return (
      <Box flexDirection="column" gap={1}>
        {/* Encabezado: estado y recarga en una sola línea */}
        <Box flexDirection="row" justifyContent="space-between" alignItems="center">
          <Text dimColor size="caption">
            {state === 'loading' ? 'Cargando tus tareas…' : state !== 'error' && at ? `${pendingCount} pendientes · ${at}` : ''}
          </Text>
          <Button key="reload" label="↻ Recargar" dimColor onPress={() => void refresh($)} />
        </Box>

        {state === 'error' && <Text color="red" wrap="wrap">No pude leer Taskia: {err}</Text>}
        {state === 'ready' && list.length === 0 && <Text>No tienes tareas pendientes.</Text>}

        {/* Workspaces: se pueden marcar varios; ninguno marcado es todos */}
        {state !== 'error' && list.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            <Button key="ws-all" plain dimColor={!all} onPress={() => void choose($, null)}>
              {all ? '◉ Todos' : '○ Todos'}
            </Button>
            {workspaces.map(ws => (
              <Button key={`ws-${ws}`} plain dimColor={!picked.includes(ws)} onPress={() => void choose($, ws)}>
                {picked.includes(ws) ? `☑ ${ws}` : `☐ ${ws}`}
              </Button>
            ))}
          </Box>
        )}

        {/* KPIs de lo elegido; el marcado filtra la lista */}
        {state !== 'error' && list.length > 0 && (
          <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
            {KPIS.map(k => (
              <Button key={`k-${k.id}`} plain dimColor={k.id !== filter} onPress={() => void update($, kpi, () => k.id)}>
                {k.id === filter ? '▸ ' : ''}{k.label} <Text weight="semibold">{String(scoped.filter(t => k.test(t.pct)).length)}</Text>
              </Button>
            ))}
          </Box>
        )}

        {/* Resumen; con error no se muestra lo de la carga anterior */}
        {state !== 'error' && list.length > 0 && (
          <Box flexDirection="column">
            {summary !== '' && <Text wrap="wrap">{summary}</Text>}
            <Text dimColor size="caption" wrap="wrap">
              {shown.length === 0 ? 'Nada en esta selección' : `${groups.length} workspaces`}
              {doable > 0 ? ` · ▶ ${doable} las puedo hacer yo` : ''}
            </Text>
          </Box>
        )}

        {/* Un grupo plegable por workspace; de entrada solo el primero abierto */}
        {state !== 'error' && groups.map(({ ws, items }, i) => {
          const isOpen = (i === 0) !== toggled.includes(ws)
          return (
            <Box key={`box-${ws}`} flexDirection="column">
              <Button key={`g-${ws}`} plain onPress={() => void toggle($, ws)}>
                {isOpen ? '▾ ' : '▸ '}
                <Text weight="semibold">{ws}</Text>
                <Text dimColor> {items.length}</Text>
              </Button>
              {isOpen && (
                <Box flexDirection="column" gap={1}>
                  {items.map(t => (
                    <Box key={`row-${t.ref}`} flexDirection="column">
                      <Text wrap="wrap">{t.canDo ? '▶ ' : '○ '}{t.name}</Text>
                      {t.path !== '' && <Text dimColor size="caption" wrap="wrap">↳ {t.path}</Text>}
                      <Text dimColor size="caption" wrap="wrap">
                        {[t.status, `${t.pct}%`, t.advice !== '' ? `→ ${t.advice}` : ''].filter(Boolean).join(' · ')}
                      </Text>
                      <Button key={`t-${t.ref}`} plain dimColor onPress={() => void $.prompt.submit({ text: startPrompt(t) })}>
                        {t.canDo ? 'Empezar' : 'Preparar'}
                      </Button>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )
        })}

        {state !== 'error' && list.length > 0 && <Text dimColor size="caption" wrap="wrap">▶ la hago yo · ○ te la preparo · Empezar/Preparar para arrancar</Text>}
      </Box>
    )
  })
}
