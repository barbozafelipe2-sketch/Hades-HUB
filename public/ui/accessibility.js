export function installAccessibility(){
let activeDialog=null,dialogOpener=null,dialogInert=[];
function syncAccessibility(){
  document.querySelectorAll('.field').forEach(field=>{
    const label=field.querySelector('label'),control=field.querySelector('input,select,textarea');
    if(label&&control&&!control.labels?.length){if(!control.id)control.id='field-'+crypto.randomUUID();label.htmlFor=control.id;}
  });
  document.querySelectorAll('[data-risk],[data-display]').forEach(el=>{
    el.setAttribute('role','button');el.tabIndex=0;
    el.setAttribute('aria-pressed',String(el.classList.contains('active')));
    el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};
  });
  const dialog=['#runtimeModal','#onboard','#signupModal','#advisorDrawer','#systemDrawer'].map(q=>document.querySelector(q)).find(el=>el&&el.getClientRects().length&&!el.classList.contains('hidden')&&el.getAttribute('aria-hidden')!=='true');
  if(dialog===activeDialog)return;
  for(const [el,was] of dialogInert)el.inert=was;dialogInert=[];
  const previousOpener=dialogOpener;
  activeDialog=dialog||null;
  if(!dialog){dialogOpener=null;if(previousOpener?.isConnected)previousOpener.focus();return;}
  dialogOpener=dialog.returnFocusTarget||document.activeElement;
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');
  if(!dialog.getAttribute('aria-labelledby')&&!dialog.getAttribute('aria-label'))dialog.setAttribute('aria-label',dialog.querySelector('h2,h3')?.textContent||'Dialog');
  for(let branch=dialog;branch&&branch!==document.body;branch=branch.parentElement){
    for(const sibling of branch.parentElement?.children||[]){if(sibling!==branch){dialogInert.push([sibling,sibling.inert]);sibling.inert=true;}}
  }
  const first=dialog.querySelector('button,input,select,textarea,[tabindex="0"]');
  if(first)first.focus();else{dialog.tabIndex=-1;dialog.focus();}
}
document.addEventListener('keydown',e=>{
  if(e.key!=='Tab'||!activeDialog)return;
  const controls=[...activeDialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
  if(!controls.length){e.preventDefault();activeDialog.focus();return;}
  const first=controls[0],last=controls.at(-1);
  if(e.shiftKey&&(document.activeElement===first||!activeDialog.contains(document.activeElement))){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&(document.activeElement===last||!activeDialog.contains(document.activeElement))){e.preventDefault();first.focus();}
});
new MutationObserver(syncAccessibility).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class','aria-hidden','style']});
syncAccessibility();


}
