import { expect, test } from 'claude-code/testing'

const items = [
  { task_ref: '1', name: 'Flujo n8n cliente', workspace_name: 'Omicron', estimatedduedate: '2026-10-16 00:00:00+00', status: 'En curso' },
  { task_ref: '2', name: 'Proyecto Farma', workspace_name: 'Farma', estimatedduedate: '2024-09-05 00:00:00+00', status: 'Ideas' },
]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Como en la app de escritorio: los conectores son IDs y el de dev tiene las mismas herramientas.
const PROD = '85455823-b86c-44ae-956c-a7ad56bed3e8'
const DEV = 'cb43329c-1bbb-4f85-a0d9-8e0b352f5cf6'
const tools = [DEV, PROD].map(s => ({ name: `mcp__${s}__agent_what_to_do_today`, description: '', mcp: true }))
  .concat([{ name: 'mcp__ccd_connectors__session_connectors_status', description: '', mcp: true }])
const connectors = {
  servers: [
    { name: 'MCP_TASKIA', id: PROD, kind: 'connector', status: 'connected' },
    { name: 'MCP_WEB_TASKIA_DEV', id: DEV, kind: 'connector', status: 'connected' },
  ],
}
const reply = (data: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false } }) as any

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: carga, clasifica y al pulsar una tarea la arranca`, async ($, on) => {
    const sent: string[] = []
    const called: string[] = []
    on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
    on('tool.list', async () => ({ value: tools }) as any)
    on('mcp.call', async (_$: any, e: any) => {
      called.push(e.server)
      if (e.server === 'ccd_connectors') return reply(connectors)
      return reply({ items: e.server === PROD ? items : [] })
    })
    on('model.complete', async () => ({
      value: {
        isAnswered: true,
        text: JSON.stringify({
          brief: 'Empieza por el flujo de n8n que vence hoy.',
          tasks: [
            { ref: '1', group: 'Urgente hoy', summary: 'Ajustar flujo', advice: 'Revisar ejecución fallida', canDo: true },
            { ref: '2', group: 'Vieja / revisar si sigue', summary: 'Proyecto viejo', advice: 'Cerrar o archivar', canDo: false },
          ],
        }),
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }) as any)
    on('prompt.submit', async (_$: any, e: any) => { sent.push(e.text); return { text: e.text } as any })

    await $.command.run({ command: 'taskia', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'taskia-hoy', surface, component: 'Pane', requestId: 'taskia-hoy', props: { title: 'Taskia · Hoy' } as any })
    // "Urgente hoy" arranca plegado: la tarea no se ve hasta abrir el grupo.
    let header
    for (let i = 0; i < 50 && !header; i++) { await sleep(10); await ui.resize?.({ columns: 60, rows: 40 } as any).catch(() => {}); header = await ui.find({ key: 'g-Urgente hoy' }) }
    expect(header).toBeDefined()
    // Solo se leyó del conector MCP_TASKIA, nunca del de dev.
    expect(called).toContain(PROD)
    expect(called).not.toContain(DEV)
    expect(await ui.find({ key: 't-1' })).toBeUndefined()
    await ui.press({ key: 'g-Urgente hoy' })
    let btn
    for (let i = 0; i < 50 && !btn; i++) { await sleep(10); btn = await ui.find({ key: 't-1' }) }
    expect(btn).toBeDefined()
    await ui.press({ key: 't-1' })
    expect(sent.length).toBe(1)
    expect(sent[0]).toContain('#1')
    expect(sent[0]).toContain('NO ejecutes')
  })
}

test('terminal: usa el conector claude.ai MCP_TASKIA por su nombre', async ($, on) => {
  const called: string[] = []
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('tool.list', async () => ({
    value: ['claude_ai_MCP_WEB_TASKIA_DEV', 'claude_ai_MCP_TASKIA'].map(s => ({ name: `mcp__${s}__agent_what_to_do_today`, description: '', mcp: true })),
  }) as any)
  on('mcp.call', async (_$: any, e: any) => { called.push(e.server); return reply({ items }) })
  on('model.complete', async () => ({ value: { isAnswered: false } }) as any)

  await $.command.run({ command: 'taskia', args: '' } as any)
  for (let i = 0; i < 50 && called.length === 0; i++) await sleep(10)
  expect(called).toEqual(['claude_ai_MCP_TASKIA'])
})
