import { initializeDatabase, prisma } from '../src/db.js'
import { getStrategy } from '../src/strategies.js'

await initializeDatabase()

const fixtures = [
  { title: 'Northstar product launch', strategyId: 'presentation', description: 'OpenDesign PR screenshot fixture: a calm, editorial product launch presentation.' },
  { title: 'Northstar visual system', strategyId: 'design-system', description: 'OpenDesign PR screenshot fixture: a reusable hardware design language.' },
] as const
await prisma.project.deleteMany({ where: { description: { startsWith: 'OpenDesign PR screenshot fixture:' } } })
const activeSystem = await prisma.designSystem.findUniqueOrThrow({ where: { id: 'acme' } })
const presentationStrategy = getStrategy(fixtures[0].strategyId)
const designSystemStrategy = getStrategy(fixtures[1].strategyId)
const [presentation, system] = await Promise.all([
  prisma.project.create({ data: { title: fixtures[0].title, strategy: presentationStrategy.id, description: fixtures[0].description, designSystemId: activeSystem.id, active: true, files: { create: presentationStrategy.createFiles(fixtures[0].title) } } }),
  prisma.project.create({ data: { title: fixtures[1].title, strategy: designSystemStrategy.id, description: fixtures[1].description, designSystemId: activeSystem.id, active: true, files: { create: designSystemStrategy.createFiles(fixtures[1].title, activeSystem.tokens) } } }),
])

await prisma.message.createMany({ data: [
  { projectId: presentation.id, role: 'user', text: 'Create a concise product launch story with an editorial, warm visual language.' },
  { projectId: presentation.id, role: 'assistant', text: '**The launch story is ready.**\n\n- Introduces the product and its audience\n- Explains the design principles\n- Closes with a clear next step' },
] })

const run = await prisma.agentRun.create({ data: {
  projectId: presentation.id,
  model: 'z-ai/glm-5.3-flash',
  prompt: 'Create a product launch presentation',
  status: 'completed',
  inputTokens: 1840,
  outputTokens: 3260,
  totalTokens: 5100,
  completedAt: new Date(),
  events: { create: [
    { type: 'thinking', text: 'Outlined a six-slide launch narrative.' },
    { type: 'change', text: 'Updated index.html', detail: '6 slides · HTML presentation', tables: ['ProjectFile'] },
    { type: 'success', text: 'Rendering validation passed', detail: 'No browser errors or overflow.', tables: ['Project', 'ProjectFile'] },
  ] },
} })

console.log(`Created screenshot fixtures: presentation=${presentation.id}, design-system=${system.id}, run=${run.id}`)
await prisma.$disconnect()
