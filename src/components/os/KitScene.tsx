import { useRef } from 'react'
import { AgentCard, BrowserWin, Cursor, Desktop, Launcher, Line, Mark, Rail, Stage, StepRow, Thinking, VoicePill, useTimeline } from './kit'
import { B } from '@/lib/brands'

/* Dev-only: every kit piece on one canvas, to calibrate the look against the real app. */
export function KitScene() {
  const ref = useRef<HTMLDivElement>(null)
  const t = useTimeline(8, ref)
  return (
    <Stage w={1600} h={1000} stageRef={ref}>
      <Desktop>
        <Rail className="left-[18px] top-[140px]" />
        <VoicePill t={t} text="Feature request." className="left-1/2 top-[24px] -translate-x-1/2" style={{ left: 800 }} />
        <AgentCard title="Post hotkeys videos" prompt="Post the new hotkeys clips to all three accounts" className="left-[110px] top-[170px]">
          <StepRow step={{ kind: 'read', label: 'Read', file: 'SKILL.md', ms: '0.4s' }} />
          <StepRow step={{ kind: 'list', label: 'Listed folder', file: 'clips/', ms: '0.2s' }} />
          <StepRow step={{ kind: 'text', label: 'Found 6 clips. Posting two per account, captions from the brief.' }} />
          <StepRow step={{ kind: 'active', label: 'Reading', file: 'captions.md' }} />
          <Thinking t={t} />
        </AgentCard>
        <AgentCard title="Messages and LinkedIn" status="done" prompt="Catch me up" className="left-[500px] top-[170px]" height={300}>
          <StepRow step={{ kind: 'browse', label: 'Opened', file: 'linkedin.com', ms: '1.2s' }} />
          <StepRow step={{ kind: 'text', label: 'You have 3 replies waiting. Maya asked about Thursday.' }} />
        </AgentCard>
        <BrowserWin url="google.com/search?q=best+food+berkeley" className="left-[900px] top-[170px] h-[220px] w-[300px]" loading={0.6}>
          <div className="flex flex-col gap-[8px] p-[14px]">
            <Line w="60%" className="bg-[#1a0dab]/40" />
            <Line w="90%" />
            <Line w="80%" />
          </div>
        </BrowserWin>
        <div className="absolute left-[900px] top-[420px] flex gap-[8px]">
          <Mark brand={B.reddit} />
          <Mark brand={B.x} fill />
          <Mark brand={B.ycombinator} fill />
          <Mark brand={B.linkedin} />
        </div>
        <Launcher
          className="left-[1220px] top-[170px] w-[360px]"
          cols={4}
          count={54}
          highlight={0}
          apps={[
            { label: 'Daily Brief', asset: 'brief' },
            { label: 'CRM Core', asset: 'crm' },
            { label: 'Akira', asset: 'akira' },
            { label: 'Post Harvester', asset: 'postHarvester' },
            { label: 'Finder', asset: 'finder' },
            { label: 'Git Graph', asset: 'gitGraph' },
            { label: 'Lead Finder', asset: 'leads' },
            { label: 'Validator', asset: 'validator' },
          ]}
        />
        <Cursor x={1300} y={300} click={(t % 2) / 1} />
      </Desktop>
    </Stage>
  )
}
