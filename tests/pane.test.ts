import { expect, test } from 'claude-code/testing'

const items = [
  { task_ref: '1', name: 'Flujo n8n cliente', workspace_name: 'Omicron', estimatedduedate: '2026-10-16 00:00:00+00', status: 'En curso' },
  { task_ref: '2', name: 'Proyecto Farma', workspace_name: 'Farma', estimatedduedate: '2024-09-05 00:00:00+00', status: 'Ideas' },
]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: carga, clasifica y al pulsar una tarea la arranca`, async ($, on) => {
    const sent: string[] = []
    on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
    on('mcp.call', async () => ({ value: { content: [{ type: 'text', text: JSON.stringify({ items }) }], isError: false } }) as any)
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
    expect(await ui.find({ key: 't-1' })).toBeUndefined()
    await ui.press({ key: 'g-Urgente hoy' })
    let btn
    for (let i = 0; i < 50 && !btn; i++) { await sleep(10); btn = await ui.find({ key: 't-1' }) }
    expect(btn).toBeDefined()
    await ui.press({ key: 't-1' })
    expect(sent.length).toBe(1)
    expect(sent[0]).toContain('#1')
  })
}
