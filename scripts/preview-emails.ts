import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderWaitlistEmail, type WaitlistEmailKind } from '../server/waitlist-email.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'docs/email-preview')
const kinds: WaitlistEmailKind[] = ['welcome', 'priority']
const messages = Object.fromEntries(kinds.map((kind) => [kind, renderWaitlistEmail({
  kind, referralCode: 'preview_' + '0'.repeat(24), publicUrl: 'https://openswarm.com',
  unsubscribeUrl: 'https://openswarm.com/api/waitlist/unsubscribe?token=preview-only-not-a-real-subscription',
})]))
const gallery = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Open Swarm · Email previews</title><style>
*{box-sizing:border-box}body{margin:0;background:#e8eef2;color:#17232b;font:14px/1.5 system-ui,sans-serif}header{background:#fff;border-bottom:1px solid #d4dee5;padding:20px 28px;position:sticky;top:0;z-index:2}h1{font-size:20px;letter-spacing:-.5px;margin:0 0 4px}p{margin:0;color:#5f7180}nav{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:16px}button,a{font:inherit}button{border:1px solid #c9d6df;background:white;color:#243c4b;border-radius:7px;padding:7px 12px;cursor:pointer}button[aria-pressed=true]{background:#17232b;color:white;border-color:#17232b}button:focus-visible,a:focus-visible{outline:2px solid #428cba;outline-offset:3px}a{color:#2a6287}.divider{width:1px;height:24px;background:#d4dee5;margin:0 5px}.envelope{margin:24px auto 0;max-width:640px;background:white;padding:16px 20px;border:1px solid #d8e1e7;border-radius:10px 10px 0 0}.envelope p{font-size:12px}.envelope strong{color:#17232b}.stage{margin:0 auto 32px;max-width:640px;width:100%}iframe{width:100%;height:1320px;display:block;border:0;border-radius:0 0 10px 10px}.note{max-width:640px;margin:0 auto 36px;padding:0 20px;font-size:12px}.download{margin-left:auto}.flow{max-width:640px;margin:0 auto 32px;padding:24px;background:white;border:1px solid #d4dee5;border-radius:12px}.flow h2{font-size:16px;margin:0 0 14px}.flow ol{padding-left:22px;margin-bottom:0}.flow li{margin:12px 0}.flow small{color:#5f7180}@media(max-width:680px){header{padding:16px}.envelope,.flow{margin-left:10px;margin-right:10px}.download{margin-left:0}.stage{max-width:100%}}@media(prefers-reduced-motion:reduce){.stage{transition:none}}
</style></head><body><header><h1>Open Swarm / The waitlist, in your inbox.</h1><p>A saved spot, a personal invite, and a little head start.</p><nav aria-label="Email preview controls"><button data-kind="welcome" aria-pressed="true">01 · Confirmation</button><button data-kind="priority" aria-pressed="false">02 · Priority unlocked</button><span class="divider"></span><button id="desktop" aria-pressed="true">Desktop</button><button id="mobile" aria-pressed="false">Mobile</button><button id="dark" aria-pressed="false">Dark preview</button><a class="download" id="html" href="welcome.html" download>Preview HTML</a><a id="text" href="welcome.txt">Plain text</a></nav></header><section class="envelope" aria-label="Email envelope"><p>FROM &nbsp;<strong>Open Swarm</strong> · sender address configured at activation</p><p style="margin-top:5px">SUBJECT &nbsp;<strong id="subject">${messages.welcome.subject}</strong></p></section><div class="stage" id="stage"><iframe title="Waitlist confirmation email" id="email" src="welcome.html"></iframe></div><p class="note">Preview data only. The invite token is fictional and unsubscribe is intentionally inactive here. Dark preview keeps the paper-style email on a dark inbox background; rendering varies by client.</p><section class="flow"><h2>The flow</h2><ol><li><strong>A new email joins.</strong><br><small>Save the signup and queue its confirmation together. A repeat signup returns the existing invite link.</small></li><li><strong>Send the confirmation.</strong><br><small>Confirm the place, set expectations, and offer a personal invite link. Failed sends retry without losing the signup.</small></li><li><strong>Three friends join.</strong><br><small>Queue one priority-unlocked email. Actual access arrives in a separate future invitation.</small></li><li><strong>Respect the inbox.</strong><br><small>Unsubscribe stops future waitlist email; referral progress stays intact. Launch updates wait for a real announcement.</small></li></ol></section><script>
const subjects=${JSON.stringify(Object.fromEntries(kinds.map(k=>[k,messages[k].subject])))};let selected='welcome',dark=false;const frame=document.getElementById('email');
function fitFrame(){try{frame.style.height='0px';frame.style.height=Math.max(400,frame.contentDocument.documentElement.scrollHeight,frame.contentDocument.body.scrollHeight)+'px'}catch{frame.style.height='1320px'}}frame.addEventListener('load',fitFrame);window.addEventListener('resize',fitFrame);
function update(){frame.src=selected+(dark?'-dark':'')+'.html';frame.title=selected==='welcome'?'Waitlist confirmation email':'Priority unlocked email';document.getElementById('subject').textContent=subjects[selected];document.getElementById('html').href=selected+'.html';document.getElementById('text').href=selected+'.txt'}
document.querySelectorAll('[data-kind]').forEach(button=>button.addEventListener('click',()=>{selected=button.dataset.kind;document.querySelectorAll('[data-kind]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));update()}));
['desktop','mobile'].forEach(mode=>document.getElementById(mode).addEventListener('click',()=>{document.getElementById('stage').style.width=mode==='mobile'?'390px':'100%';document.getElementById('desktop').setAttribute('aria-pressed',String(mode==='desktop'));document.getElementById('mobile').setAttribute('aria-pressed',String(mode==='mobile'));fitFrame()}));document.getElementById('dark').addEventListener('click',()=>{dark=!dark;document.getElementById('dark').setAttribute('aria-pressed',String(dark));update()});
</script></body></html>`

await mkdir(output, { recursive: true })
await writeFile(path.join(output, 'index.html'), gallery)
for (const kind of kinds) {
  // Preview assets resolve from this repository. Production HTML retains absolute HTTPS URLs.
  const html = messages[kind].html.replaceAll('src="https://openswarm.com/media/', 'src="../../public/media/')
  await writeFile(path.join(output, `${kind}.html`), html.replace('@media (prefers-color-scheme:dark)', '@media not all'))
  await writeFile(path.join(output, `${kind}-dark.html`), html.replace('@media (prefers-color-scheme:dark)', '@media screen'))
  await writeFile(path.join(output, `${kind}.txt`), messages[kind].text)
}
if (process.argv.includes('--build')) {
  console.log('Email HTML, plain text and preview gallery exported to docs/email-preview/. No email sent.')
} else {
  const routes = new Map<string, {file:string,type:string}>([
    ['/',{file:'docs/email-preview/index.html',type:'text/html'}],
    ...['index.html','welcome.html','priority.html','welcome-dark.html','priority-dark.html','welcome.txt','priority.txt'].map(name=>[`/${name}`,{file:`docs/email-preview/${name}`,type:name.endsWith('.txt')?'text/plain':'text/html'}] as [string,{file:string,type:string}]),
    ['/public/media/email/invitations.jpg',{file:'public/media/email/invitations.jpg',type:'image/jpeg'}],
    ['/public/media/logo-256.png',{file:'public/media/logo-256.png',type:'image/png'}],
  ])
  createServer(async (req,res)=>{
    const route=routes.get(new URL(req.url??'/', 'http://localhost').pathname)
    if(!route){res.writeHead(404);res.end('Not found');return}
    try{const bytes=await readFile(path.join(root,route.file));res.writeHead(200,{'Content-Type':`${route.type}; charset=utf-8`,'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'});res.end(bytes)}catch{res.writeHead(500);res.end('Preview unavailable')}
  }).listen(4312,'127.0.0.1',()=>console.log('Email previews: http://localhost:4312 — synthetic data only; no emails sent.'))
}
