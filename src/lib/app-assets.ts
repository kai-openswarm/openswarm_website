/** Original app artwork. Paths are relative to media(), so previews also work under a base URL. */
export type AppAsset = {
  src: string
  title: string
  kind: 'native' | 'custom'
  width: number
  height: number
}

export const APP_ASSETS = {
  brief: { src: 'apps/daily-brief.webp', title: 'Daily Brief', kind: 'custom', width: 256, height: 256 },
  messages: { src: 'apps/apple-messages.png', title: 'Messages', kind: 'native', width: 256, height: 256 },
  facetime: { src: 'apps/apple-facetime.png', title: 'FaceTime', kind: 'native', width: 256, height: 256 },
  chatgpt: { src: 'apps/chatgpt.png', title: 'ChatGPT', kind: 'native', width: 256, height: 256 },
  claude: { src: 'apps/claude.png', title: 'Claude', kind: 'native', width: 256, height: 256 },
  safari: { src: 'apps/apple-safari.png', title: 'Safari', kind: 'native', width: 256, height: 256 },
  calendar: { src: 'apps/apple-calendar.png', title: 'Calendar', kind: 'native', width: 256, height: 256 },
  finder: { src: 'apps/apple-finder.png', title: 'Finder', kind: 'native', width: 256, height: 256 },
  crm: { src: 'apps/openswarm-crm.webp', title: 'CRM Core', kind: 'custom', width: 512, height: 512 },
  leads: { src: 'apps/openswarm-leads.png', title: 'Lead Finder', kind: 'custom', width: 124, height: 124 },
  validator: { src: 'apps/openswarm-validator.webp', title: 'Problem Validator', kind: 'custom', width: 464, height: 459 },
  postHarvester: { src: 'apps/openswarm-post-harvester.webp', title: 'Post Harvester', kind: 'custom', width: 512, height: 512 },
  socialFootprint: { src: 'apps/openswarm-social-footprint.webp', title: 'Social Footprint Finder', kind: 'custom', width: 512, height: 512 },
  skillEditor: { src: 'apps/openswarm-skill-editor.webp', title: 'Skill Editor', kind: 'custom', width: 128, height: 128 },
  styleGuide: { src: 'apps/openswarm-style-guide.webp', title: 'Style Guide Extractor', kind: 'custom', width: 104, height: 104 },
  gitGraph: { src: 'apps/openswarm-git-graph.webp', title: 'Git Graph', kind: 'custom', width: 105, height: 105 },
  analytics: { src: 'apps/openswarm-analytics.webp', title: 'Analytics Refresh', kind: 'custom', width: 128, height: 128 },
  akira: { src: 'apps/openswarm-akira.svg', title: 'Akira', kind: 'custom', width: 64, height: 64 },
} as const satisfies Record<string, AppAsset>

export type AppAssetId = keyof typeof APP_ASSETS
