export function createPaperBuildReview({api,openRuntimeModal,loading,toast,money,esc,onApplied}){
  let preparing=false;
  return async ({budget,focus,button})=>{
    if(preparing)return;
    preparing=true;loading(button,true,'Preparing review');
    try{
      const plan=await api('portfolio-build',{method:'POST',body:JSON.stringify({action:'previewBuild',budget,focus}),timeoutMs:60000});
      const rows=plan.buys.map(b=>`<tr><th scope="row">${esc(b.symbol)}</th><td>${esc(b.quantity)}</td><td>${money(b.unitPrice)}</td><td>${money(b.amount)}</td></tr>`).join('');
      let confirming=false;
      openRuntimeModal({opener:button,title:'Review simulated purchases',submitLabel:'Confirm paper purchases',body:`<p>Simulation only. Review the amounts below before confirming. Prices and buying power will be checked again.</p><div class="paper-review-summary"><span>Budget <strong>${money(plan.budget)}</strong></span><span>Simulated deposit <strong>${money(plan.deposited)}</strong></span><span>Cash after purchases <strong>${money(plan.portfolio.cash)}</strong></span></div><div class="paper-review-table"><table><caption>Proposed purchases · USD</caption><thead><tr><th scope="col">Asset</th><th scope="col">Quantity</th><th scope="col">Price</th><th scope="col">Amount</th></tr></thead><tbody>${rows}</tbody></table></div>${plan.skipped.length?`<p>Skipped: ${plan.skipped.map(x=>`${esc(x.symbol)} (${esc(x.reason)})`).join(', ')}</p>`:''}<p class="tiny">This review expires at ${esc(new Date(plan.expiresAt).toLocaleTimeString())}. A changed price or wallet requires a new review.</p>`,onSubmit:async()=>{
        if(confirming)return;
        confirming=true;
        try{
          const result=await api('portfolio-build',{method:'POST',body:JSON.stringify({action:'confirmBuild',planId:plan.planId}),timeoutMs:60000});
          await onApplied(result);toast('Confirmed simulated purchases saved.');
        }finally{confirming=false;}
      }});
    }catch(error){toast(error.message);}finally{preparing=false;loading(button,false);}
  };
}
