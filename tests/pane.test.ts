import { expect, test } from 'claude-code/testing'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Mis tareas (mine: true). Pendientes: 1, 2, 8 y 9 (devuelta, 60%). Aprobada: 10 (90%), solo cuenta en su KPI.
// Fuera: 5 tiene hijas, 6 va por 95%, 7 está cancelada.
const mine = [
  { task_ref: '1', name: 'Rediseño del flujo de compras con un nombre bastante largo para ver que no se corta', workspace_name: 'Cliente A', status: 'Por hacer', has_child_tasks: false },
  { task_ref: '2', name: 'Ordenar gastos', workspace_name: 'Interno', status: 'En progreso', accomplishment: 50, has_child_tasks: false },
  { task_ref: '5', name: '3. Propuesta', workspace_name: 'Cliente A', status: 'Por hacer', accomplishment: 0, has_child_tasks: true },
  { task_ref: '6', name: 'Casi lista', workspace_name: 'Cliente A', status: 'En progreso', accomplishment: 95, has_child_tasks: false },
  { task_ref: '7', name: 'Ya no va', workspace_name: 'Cliente A', status: 'Cancelada', has_child_tasks: false },
  { task_ref: '8', name: 'Revisar inventario', workspace_name: 'Cliente A', status: 'En progreso', accomplishment: 30, has_child_tasks: false },
  { task_ref: '9', name: 'Corregir cotización', workspace_name: 'Cliente A', status: 'Por revisar', accomplishment: 60, has_child_tasks: false },
  { task_ref: '10', name: 'Manual de bienvenida', workspace_name: 'Interno', status: 'Por revisar', accomplishment: 90, has_child_tasks: false },
]
// Todo el workspace (mine: false): la fase 4 es de otra persona y de ella cuelga la propuesta.
const workspace: Record<string, any[]> = {
  'Cliente A': [...mine.filter(t => t.workspace_name === 'Cliente A'), { task_ref: '4', name: 'Fase 2', workspace_name: 'Cliente A', has_child_tasks: true }],
  Interno: mine.filter(t => t.workspace_name === 'Interno'),
}
const children: Record<string, any[]> = { '4': [{ task_ref: '5' }, { task_ref: '8' }], '5': [{ task_ref: '1' }, { task_ref: '6' }] }

// Como en la app de escritorio: los conectores son IDs y el de dev tiene las mismas herramientas.
const PROD = '85455823-b86c-44ae-956c-a7ad56bed3e8'
const DEV = 'cb43329c-1bbb-4f85-a0d9-8e0b352f5cf6'
const tools = [DEV, PROD].map(s => ({ name: `mcp__${s}__agent_search_tasks`, description: '', mcp: true }))
  .concat([{ name: 'mcp__ccd_connectors__session_connectors_status', description: '', mcp: true }])
const connectors = {
  servers: [
    { name: 'MCP_TASKIA', id: PROD, kind: 'connector', status: 'connected' },
    { name: 'MCP_WEB_TASKIA_DEV', id: DEV, kind: 'connector', status: 'connected' },
    { name: 'Microsoft 365', id: 'm365', kind: 'connector', status: 'connected' },
    { name: 'plugin:pdf-viewer:pdf', kind: 'plugin', status: 'connected' },
    { name: 'Gmail', id: 'gmail', kind: 'connector', status: 'needs_auth' },
  ],
}
const reply = (data: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false } }) as any

// Un Taskia de mentira: búsqueda propia, búsqueda por workspace e hijas.
function taskia(e: any) {
  if (e.tool === 'agent_search_tasks') {
    const items = e.args.mine ? mine : workspace[e.args.workspace] ?? []
    return reply({ items, pagination: { has_more: false } })
  }
  if (e.tool === 'agent_list_task_children') return reply({ children: children[e.args.task_ref] ?? [] })
  return reply({})
}

function mockTaskia(on: any, called: string[], list = tools, conns: unknown = connectors) {
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('tool.list', async () => ({ value: list }) as any)
  on('mcp.call', async (_$: any, e: any) => {
    called.push(e.server)
    return e.server === 'ccd_connectors' ? reply(conns) : taskia(e)
  })
}

async function waitFor<T>(fn: () => Promise<T | undefined>): Promise<T | undefined> {
  let v: T | undefined
  for (let i = 0; i < 80 && !v; i++) { await sleep(10); v = await fn() }
  return v
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: hojas pendientes por workspace, con su camino, y al pulsar arranca`, async ($, on) => {
    const sent: string[] = []
    const called: string[] = []
    mockTaskia(on, called)
    on('model.complete', async () => ({
      value: {
        isAnswered: true,
        text: JSON.stringify({
          brief: 'Empieza por revisar el inventario.',
          tasks: [{ ref: '1', advice: 'Hablar con compras', canDo: true }],
        }),
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }) as any)
    on('prompt.submit', async (_$: any, e: any) => { sent.push(e.text); return { text: e.text } as any })

    await $.command.run({ command: 'taskia', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'taskia-hoy', surface, component: 'Pane', requestId: 'taskia-hoy', props: { title: 'Taskia · Hoy' } as any })
    await ui.resize?.({ columns: 60, rows: 60 } as any).catch(() => {})

    // "Cliente A" tiene más tareas: va primero y abierto; "Interno" cerrado.
    expect(await waitFor(() => ui.find({ key: 't-1' }))).toBeDefined()
    expect(await ui.find({ key: 'g-Cliente A' })).toBeDefined()
    expect(await ui.find({ key: 'g-Interno' })).toBeDefined()
    expect(await ui.find({ key: 't-2' })).toBeUndefined()
    // Fuera: la que tiene hijas, la de 95% y la cancelada.
    for (const ref of ['5', '6', '7']) expect(await ui.find({ key: `t-${ref}` })).toBeUndefined()
    // Solo se leyó del conector MCP_TASKIA, nunca del de dev.
    expect(called).toContain(PROD)
    expect(called).not.toContain(DEV)

    await ui.press({ key: 'g-Interno' })
    expect(await waitFor(() => ui.find({ key: 't-2' }))).toBeDefined()

    await ui.press({ key: 't-1' })
    expect(sent.length).toBe(1)
    expect(sent[0]).toContain('#1')
    expect(sent[0]).toContain('dentro de Fase 2 › 3. Propuesta')
    expect(sent[0]).toContain('NO ejecutes')
  })
}

// El camino y el orden que recibe el modelo, sin depender de cómo se dibuja.
async function classifyInput($: any, on: any): Promise<{ prompt: string; tasks: any[] }> {
  const prompts: string[] = []
  mockTaskia(on, [])
  on('model.complete', async (_$: any, e: any) => { prompts.push(e.prompt); return { value: { isAnswered: false } } as any })
  await $.command.run({ command: 'taskia', args: '' } as any)
  for (let i = 0; i < 80 && prompts.length === 0; i++) await sleep(10)
  const prompt = prompts[0] ?? ''
  return { prompt, tasks: JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1) || '[]') }
}

test('arma el camino desde los padres, aunque no sean míos, y ordena por workspace y estado', async ($, on) => {
  const { tasks } = await classifyInput($, on)
  expect(tasks.map((t: any) => t.ref)).toEqual(['8', '9', '1', '2'])
  expect(tasks.find((t: any) => t.ref === '1').path).toBe('Fase 2 › 3. Propuesta')
  expect(tasks.find((t: any) => t.ref === '8').path).toBe('Fase 2')
  expect(tasks.find((t: any) => t.ref === '2').path).toBe('')
})

test('sin perfil: deduce el rol, no usa fechas y lista solo los conectores conectados', async ($, on) => {
  const { prompt } = await classifyInput($, on)
  expect(prompt).toContain('dedúcelo')
  expect(prompt).toContain('casi no usa fechas')
  expect(prompt).toContain('Microsoft 365, pdf')
  expect(prompt).not.toContain('Gmail')
  expect(prompt).not.toContain('TASKIA')
})

test('con perfil: lo usa tal cual', { options: { perfil: 'coordinador de logística de una empresa de transporte' } }, async ($, on) => {
  const { prompt } = await classifyInput($, on)
  expect(prompt).toContain('esta persona: coordinador de logística de una empresa de transporte')
  expect(prompt).not.toContain('dedúcelo')
})

test('desktop: acepta el conector llamado Taskia', async ($, on) => {
  const called: string[] = []
  mockTaskia(on, called, tools, { servers: [
    { name: 'MCP_WEB_TASKIA_DEV', id: DEV, kind: 'connector', status: 'connected' },
    { name: 'Taskia', id: PROD, kind: 'connector', status: 'connected' },
  ] })
  on('model.complete', async () => ({ value: { isAnswered: false } }) as any)
  await $.command.run({ command: 'taskia', args: '' } as any)
  for (let i = 0; i < 50 && !called.includes(PROD); i++) await sleep(10)
  expect(called).toContain(PROD)
  expect(called).not.toContain(DEV)
})

for (const name of ['MCP_TASKIA', 'Taskia']) {
  test(`terminal: acepta el conector claude.ai ${name}`, async ($, on) => {
    const called: string[] = []
    const list = ['claude_ai_MCP_WEB_TASKIA_DEV', `claude_ai_${name}`].map(s => ({ name: `mcp__${s}__agent_search_tasks`, description: '', mcp: true }))
    mockTaskia(on, called, list)
    on('model.complete', async () => ({ value: { isAnswered: false } }) as any)
    await $.command.run({ command: 'taskia', args: '' } as any)
    for (let i = 0; i < 50 && called.length === 0; i++) await sleep(10)
    expect(called.length).toBeGreaterThan(0)
    expect([...new Set(called)]).toEqual([`claude_ai_${name}`])
  })
}

// Modo auto sin permisos: el error explica en español qué agregar, sin datos viejos.
test('modo auto: si bloquea la lectura, dice qué permisos agregar', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('tool.list', async () => ({ value: tools }) as any)
  on('mcp.call', async (_$: any, e: any) => {
    if (e.server === 'ccd_connectors') return reply(connectors)
    return { deny: 'The server-side auto mode classifier gave no verdict' } as any
  })
  await $.command.run({ command: 'taskia', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'taskia-hoy', surface: 'desktop', component: 'Pane', requestId: 'taskia-hoy', props: { title: 'Taskia · Hoy' } as any })
  const err = await waitFor(() => ui.find({ text: /modo auto bloqueó/ }))
  expect(err?.text).toContain('agent_search_tasks y agent_list_task_children')
  expect(await ui.find({ text: /refused/ })).toBeUndefined()
})

// KPIs por workspace elegido: el marcado filtra la lista y la elección se guarda.
test('desktop: KPIs de los workspaces elegidos, filtran la lista y se recuerdan', async ($, on) => {
  const store = new Map<string, unknown>()
  on('store.set', async (_$: any, e: any) => { store.set(e.key, e.value); return { value: undefined } as any })
  mockTaskia(on, [])
  on('model.complete', async () => ({ value: { isAnswered: false } }) as any)
  await $.command.run({ command: 'taskia', args: '' } as any)
  const ui = await $.ui.mount({ plugin: 'taskia-hoy', surface: 'desktop', component: 'Pane', requestId: 'taskia-hoy', props: { title: 'Taskia · Hoy' } as any })
  const kpi = async (id: string) => (await ui.find({ key: `k-${id}` }))?.text ?? ''

  // Todos: 4 pendientes (1, 2, 8, 9), 3 nuevas, 1 devuelta, 1 aprobada.
  expect(await waitFor(() => ui.find({ key: 't-1' }))).toBeDefined()
  expect(await kpi('pending')).toContain('4')
  expect(await kpi('new')).toContain('3')
  expect(await kpi('returned')).toContain('1')
  expect(await kpi('approved')).toContain('1')
  expect(await ui.find({ key: 't-10' })).toBeUndefined()

  // Solo Interno: 1 pendiente, 1 nueva, 0 devueltas, 1 aprobada.
  await ui.press({ key: 'ws-Interno' })
  expect(await waitFor(async () => ((await kpi('pending')).includes('1') ? true : undefined))).toBe(true)
  expect(await kpi('returned')).toContain('0')
  expect(store.get('selected')).toEqual(['Interno'])

  // Aprobadas muestra la de 90%; Devueltas en Cliente A + Interno muestra la de 60%.
  await ui.press({ key: 'k-approved' })
  expect(await waitFor(() => ui.find({ key: 't-10' }))).toBeDefined()
  await ui.press({ key: 'ws-Cliente A' })
  await ui.press({ key: 'k-returned' })
  expect(await waitFor(() => ui.find({ key: 't-9' }))).toBeDefined()
  expect(await ui.find({ key: 't-10' })).toBeUndefined()
  expect(store.get('selected')).toEqual(['Interno', 'Cliente A'])

  // Todos limpia la elección.
  await ui.press({ key: 'ws-all' })
  expect(store.get('selected')).toEqual([])
})
