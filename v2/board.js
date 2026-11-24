"use strict";

const el = id => document.getElementById(id);
const esc = value => String(value ?? "—").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
const pct = value => value == null ? "—" : (Math.abs(value)<.00005 ? "0.00" : (value*100).toFixed(2)) + "%";
const pp = value => value == null ? "—" : (value>0 ? "+" : "") + (value*100).toFixed(2) + "%p";
const num = value => value == null ? "—" : Number(value).toLocaleString("ko-KR",{maximumFractionDigits:2});
const sign = value => value > 0 ? "good" : value < 0 ? "bad" : "";
let report;
let aux;
const pages={rank:"전략 순위",signals:"지표·신호",regimes:"국면",validation:"검증",portfolio:"계좌 모의",live:"신호 상태",data:"데이터"};
const scopes={common:"공통",kr:"한국",us:"미국"};
const gates={G1:"데이터 정합성",G2:"표본",G3:"성과",G4:"낙폭",G5:"강건성",G6:"군집 일반화",G7:"독립 검증",G8:"모의운용"};
const states={PASS:"통과",FAIL:"실패",INSUFFICIENT:"증거 부족",NOT_RUN:"미실행",ERROR:"오류"};
const family={A:"동일 지표",B:"교차 조합",C:"국면 필터",D:"복합 조건",E:"국면별 규칙"};
const regimeNames={R1:"상승 초기",R2:"상승 지속",R3:"상승 둔화",R4:"횡보",R5:"하락 지속",R6:"하락 둔화·회복",U:"미확정"};
const state={view:"rank",scope:"common",profile:"Balanced",family:"all",regime:"all",cluster:"all",mode:"research",
             id:"",page:0,asset:"SPY",signal:"EMA_IN",horizon:"4",market:"US",dimension:"regime"};
const auxiliaryNames={RSI50:"RSI 50",MACD_ACCEL:"MACD 가속",ROC_PCTL:"ROC 백분위",
  CMF_SLOPE:"CMF 기울기",RSI_DIV:"RSI 다이버전스",OBV_DIV:"OBV 다이버전스",
  EMA_PERSIST:"EMA 지속",BB_SQUEEZE:"밴드 압축 후 돈치안 돌파"};
const modeNames={STRATEGY:"40주선 전략",DCA:"정기 매수",CASH:"현금 보유"};

function readHash() {
  for (const [key,value] of new URLSearchParams(location.hash.slice(1))) if (Object.hasOwn(state,key)) state[key]=value;
  if (!Object.hasOwn(pages,state.view)) state.view="rank";
  if (!Object.hasOwn(scopes,state.scope)) state.scope="common";
}
function updateHash() {
  const keys=["view","scope","profile","family","regime","cluster","mode","id","asset","signal","horizon","market","dimension"];
  history.replaceState(null,"","#"+new URLSearchParams(keys.map(key=>[key,state[key]])));
}
function picker(key, label, options) {
  return `<label>${esc(label)}<select data-state="${key}">${Object.entries(options)
    .map(([k,v])=>`<option value="${esc(k)}"${state[key]===String(k)?" selected":""}>${esc(v)}</option>`).join("")}</select></label>`;
}
function stats(items) {
  return `<dl class="metrics">${items.map(([label,value,cls=""])=>`<div><dt>${esc(label)}</dt><dd class="${cls}">${esc(value)}</dd></div>`).join("")}</dl>`;
}
function table(head, rows) {
  return `<div class="table-scroll" tabindex="0"><table><thead><tr>${head.map(item=>`<th scope="col">${esc(item)}</th>`).join("")}
   </tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${esc(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function signalName(key) {
  const raw=key.replace(/_(IN|OUT)$/,"");
  return report.legacy[raw]?.name ?? auxiliaryNames[raw] ?? raw;
}
function ruleName(r) {
  if (r.op==="SIGNAL") return signalName(r.id);
  if (r.op==="TRAILING_ATR") return "ATR 추적 "+r.multiplier;
  if (r.op==="POSITIVE") return r.feature+" 양수";
  if (r.op==="REGIME_IN") return ruleName(r.rule)+" ["+r.states.join(", ")+"]";
  return r.args.map(ruleName).join(r.op==="AND"?" + ":" 또는 ");
}
function chart(lines, label, drawdown=false) {
  const series=Object.entries(lines).filter(([,v])=>v.length>1);
  if (!series.length) return "";
  const normalized=series.map(([key,rows])=>{
    let peak=1;
    return [key,rows.map(([date,value])=>{peak=Math.max(peak,value);return [date,drawdown?value/peak-1:value];})];
  });
  const values=normalized.flatMap(([,rows])=>rows.map(row=>row[1]));
  const low=Math.min(...values), high=Math.max(...values), span=Math.max(high-low,1e-8);
  const palette=["#006a59","#566eb2","#987033"];
  const paths=normalized.map(([,rows],i)=>`<polyline fill="none" stroke="${palette[i%3]}" stroke-width="2.5"
    points="${rows.map(([,value],j)=>`${32+j*552/(rows.length-1)},${122-(value-low)*101/span}`).join(" ")}"/>`).join("");
  return `<svg class="chart" viewBox="0 0 610 146" role="img" aria-label="${esc(label)}"><path d="M32 18V122H585" fill="none" stroke="#c9d5d5"/>${paths}</svg>
    <div class="tags">${normalized.map(([key],i)=>`<span style="color:${palette[i%3]}">${esc(key)}</span>`).join("")}
    <span>${drawdown?pct(low):num(low)} ~ ${drawdown?pct(high):num(high)}</span></div>`;
}
function detail(row) {
  if (!row) return "";
  const obj=report.strategies[row.strategy_id];
  const ablation=row.regime_ablation;
  const history=report.historical.filter(d=>d.strategy_id===row.strategy_id);
  const curves=report.charts[row.strategy_id]||{};
  const comparisons=Object.fromEntries(Object.entries(curves).map(([name,line])=>[name+" 전략",line]));
  for (const name of Object.keys(curves)) if (report.charts.HOLD?.[name]) comparisons[name+" 보유"]=report.charts.HOLD[name];
  return `<aside class="panel" id="detail" tabindex="-1"><h2>전략 상세</h2>
   <p><strong>${esc(ruleName(obj.entry))} → ${esc(ruleName(obj.exit))}</strong></p>
   <div class="tags"><span>주봉</span><span>${esc(family[obj.family])}</span><span>${esc(obj.regime_model)}</span><span>${esc(row.status)}</span></div>
   <p class="note pane">${esc(row.strategy_id)} · 평가 ${esc(row.evaluation_id)}</p>
   <p class="line">시장 매수 허용 ${esc(obj.market_allow.join(", ")||"전체")} · 종목 매수 허용 ${esc(obj.asset_allow.join(", ")||"전체")}
    · 시장 강제 청산 ${esc(obj.force_market.join(", ")||"없음")}</p>
   <p class="note">다음 거래일 시가 · 전량 또는 현금 · 동일 세션 매도 우선</p>
   ${stats([["기준 대비",pp(row.excess),sign(row.excess)],["고비용 CAGR",pct(row.high_cost_cagr)],["지연 CAGR",pct(row.delay_cagr)],
    ["결합 스트레스",pp(row.stress_excess),sign(row.stress_excess)],["인접 설정 중앙값",pp(row.neighbor_median)],["보유 CAGR",pct(row.buy_hold_cagr)],
    ["Sharpe",num(row.sharpe)],["Sortino",num(row.sortino)],["Calmar",num(row.calmar)]])}
   ${ablation?`<p class="line">국면을 뺀 동일 진입·청산 대비 CAGR ${esc(pp(ablation.cagr_delta))}, MDD ${esc(pp(ablation.mdd_delta))}</p>`:""}
   <details open><summary>적격 기준</summary>${table(["기준","결과"],Object.entries(row.gate).map(([k,v])=>[gates[k],states[v]||v]))}</details>
   <details><summary>외부 개발 폴드와 신뢰구간</summary>
      ${table(["개발 폴드","보유 대비 CAGR"],Object.entries(row.fold_excess).map(([k,v])=>[k,pp(v)]))}
      ${table(["블록","연환산 로그 차이 95% 구간","Holm p"],Object.entries(row.ci).map(([k,v])=>[k+"주",pp(v.lo)+" ~ "+pp(v.hi),num(v.p_holm)]))}</details>
   <details><summary>군집간 성과</summary>${table(["군집","보유 대비 CAGR"],Object.entries(row.cluster_excess).map(([k,v])=>[k,pp(v)]))}</details>
   <details><summary>잠근 후보의 후속 과거 평가</summary>${history.length?table(["평가","시나리오","CAGR 차이"],
      history.map(r=>[r.scope,r.scenario,pp(r.excess)])):"<p>이 후보는 후속 평가 대상에 포함되지 않았습니다.</p>"}
      ${chart(comparisons,"후속 과거 평가 순자산 지수")}${chart(comparisons,"후속 과거 평가 낙폭",true)}</details>
   <details><summary>전략 파라미터</summary>${table(["지표","설정"],Object.entries(obj.parameters).map(([k,v])=>[signalName(k),v.join(", ")]))}</details>
  </aside>`;
}
function rank() {
  const pane=report.panels[state.scope]||report.panels.common;
  const profile=report.profiles.includes(state.profile)?state.profile:"Balanced";
  const valid=state.mode==="eligible";
  let rows=pane.rows.filter(r=>(state.family==="all"||state.family===r.family)&&(state.regime==="all"||state.regime===r.regime_model)&&
    (state.cluster==="all"||state.cluster in r.cluster_excess)&&(!valid||Object.values(r.gate).every(v=>v==="PASS")));
  rows.sort((a,b)=>state.cluster==="all" ? b.scores[profile]-a.scores[profile]||b.excess-a.excess||a.complexity-b.complexity||a.strategy_id.localeCompare(b.strategy_id)
    : b.cluster_excess[state.cluster]-a.cluster_excess[state.cluster]||b.scores[profile]-a.scores[profile]);
  const clusters=Object.fromEntries([...new Set(pane.rows.flatMap(r=>Object.keys(r.cluster_excess)))].sort().map(v=>[v,v]));
  const size=12, pages=Math.max(1,Math.ceil(rows.length/size));
  state.page=Math.min(Number(state.page)||0,pages-1);
  const selected=rows.find(r=>r.strategy_id===state.id)||rows[state.page*size];
  const cards=rows.slice(state.page*size,(state.page+1)*size).map((r,i)=>{
    const obj=report.strategies[r.strategy_id];
    return `<article class="entry-card ${selected?.strategy_id===r.strategy_id?"active":""}"><div class="entry-head">
      <button data-strategy="${esc(r.strategy_id)}">${state.page*size+i+1}. ${esc(ruleName(obj.entry))} → ${esc(ruleName(obj.exit))}</button>
      <strong>${num(r.scores[profile])}점</strong></div>
      <div class="tags"><span>${esc(family[r.family])}</span><span>${esc(r.regime_model)}</span><span>${esc(states[r.status]||r.status)}</span></div>
      ${stats([["CAGR",pct(r.cagr)],["보유 대비",pp(r.excess),sign(r.excess)],["MDD",pct(r.mdd)],["왕복",num(r.trips)+"건"],
         ...(state.cluster==="all"?[]:[[state.cluster+" 우위",pp(r.cluster_excess[state.cluster])]])])}</article>`;
  }).join("");
  return `<div class="toolbar"><div class="switch" aria-label="시장">${Object.entries(scopes).map(([key,label])=>
     `<button data-scope="${key}" aria-pressed="${key===state.scope}">${label}</button>`).join("")}</div>
     <div class="switch"><button data-mode="research" aria-pressed="${!valid}">연구 순위</button>
      <button data-mode="eligible" aria-pressed="${valid}">운용 적격</button></div></div>
   <p class="note">${esc(pane.period)} · ${pane.assets.length}종 · ${pane.weeks}주. 아래 수익률과 MDD는 군집 가중 평균입니다.</p>
   <div class="filters pane">${picker("profile","점수 프로파일",Object.fromEntries(report.profiles.map(p=>[p,p])))}
   ${picker("family","전략 유형",{all:"전체",...family})}${picker("regime","국면 모델",{all:"전체",NONE:"미사용",THREE:"3국면",SIX:"6국면"})}
   ${picker("cluster","군집 우위 정렬",{all:"전체",...clusters})}</div>
   ${rows.length?`<div class="grid"><div><div class="cards">${cards}</div><div class="pagination">
    <button data-page="-1" ${state.page===0?"disabled":""}>이전</button><span>${state.page+1} / ${pages}</span>
    <button data-page="1" ${state.page>=pages-1?"disabled":""}>다음</button></div></div>${detail(selected)}</div>`
   :`<article class="panel"><h2>${valid?"운용 적격 전략 0개":"조건에 맞는 전략이 없습니다"}</h2>
      <p>${valid?"NO_ELIGIBLE_STRATEGY · 모든 필수 검증을 통과한 전략이 생기면 여기에 표시됩니다.":"시장 또는 필터를 변경해 보세요."}</p></article>`}`;
}
function signals() {
  if (!aux) return '<div class="panel"><p>신호 데이터를 불러오는 중입니다.</p></div>';
  const items=Object.fromEntries(aux.signal_ids.map(k=>[k,signalName(k)+(k.endsWith("_IN")?" · 매수":" · 매도")]));
  const data=aux.forward.filter(r=>r.signal===state.signal&&r.market===state.market&&String(r.horizon)===state.horizon);
  const inverse=aux.inverse.filter(r=>r.signal===state.signal&&r.market===state.market);
  const matrix=report.panels[state.scope].rows.filter(r=>r.regime_model==="NONE"&&["A","B"].includes(r.family)).slice(0,20);
  return `<div class="grid single">
    <section class="panel"><h2>확정 신호 이후 수익률</h2><div class="filters">
      ${picker("signal","신호",items)}${picker("market","시장",{KR:"한국",US:"미국"})}
      ${picker("horizon","관측 기간",{"4":"4주","8":"8주","12":"12주"})}</div>
      <p class="note">학습 구간만 사용합니다. 같은 종목·연도·국면의 비발생 주와 짝지었습니다. 매도 신호는 주식 보유를 중단한 효과를 표시합니다.</p>
      ${table(["국면","사건","중앙값","기준 대비","시간 블록","상태"],data.map(r=>[regimeNames[r.regime],r.count,pct(r.median),pp(r.excess),r.quarters,r.status]))}
      <details><summary>역방향 분석</summary>${table(["기간","종점 수익률","정밀도","재현율","사건"],inverse.map(r=>[r.horizon+"주",pct(r.terminal_return_threshold),pct(r.precision),pct(r.recall),r.events]))}</details>
      <a href="signal_metrics.csv" download>전체 6개 관측 기간 CSV</a>
    </section>
    <section class="panel"><h2>진입·청산 조합</h2><div class="switch">${Object.entries(scopes).map(([k,v])=>`<button data-scope="${k}" aria-pressed="${state.scope===k}">${v}</button>`).join("")}</div>
     <p class="note">개발 점수 상위 조합을 누르면 전략 상세가 열립니다.</p>
     ${matrix.map(r=>{const obj=report.strategies[r.strategy_id];return `<button class="matrix-cell" data-jump="${r.strategy_id}">
       ${esc(ruleName(obj.entry))} → ${esc(ruleName(obj.exit))} ${pp(r.excess)}</button>`;}).join("")}</section>
  </div>`;
}
function regimes() {
  const options=Object.fromEntries(report.dataset.map(a=>[a.symbol,a.symbol+" · "+a.name]));
  const selected=report.regimes.find(r=>r.asset===state.asset&&r.dimension===state.dimension);
  const models=report.panels[state.scope].rows.filter(r=>r.regime_ablation);
  return `<div class="grid single"><section class="panel"><h2>국면 관측</h2><div class="filters">
    ${picker("asset","종목",options)}${picker("dimension","기준",{regime:"종목 6국면",market_regime:"시장 6국면",three:"종목 3국면",market_three:"시장 3국면"})}</div>
    ${selected?`<p>마지막 확정 주 ${esc(selected.asof)} · ${esc(regimeNames[selected.last]||selected.last)}</p>
     ${table(["국면","주 수"],Object.entries(selected.counts).map(([k,v])=>[regimeNames[k]||k,v]))}
     <details><summary>전이 횟수</summary>${table(["이전 → 현재","횟수"],Object.entries(selected.transitions))}</details>`:"<p>이 종목의 국면 자료가 없습니다.</p>"}</section>
    <section class="panel"><h2>같은 규칙의 국면 필터 증분</h2><div class="switch">${Object.entries(scopes).map(([k,v])=>`<button data-scope="${k}" aria-pressed="${k===state.scope}">${v}</button>`).join("")}</div>
     ${table(["진입 → 청산","모델","CAGR 차이","MDD 차이"],models.map(r=>{const obj=report.strategies[r.strategy_id];return [ruleName(obj.entry)+" → "+ruleName(obj.exit),r.regime_model,pp(r.regime_ablation.cagr_delta),pp(r.regime_ablation.mdd_delta)];}))}</section></div>`;
}
function validation() {
  return `<div class="grid single"><section class="panel"><h2>검증 결과</h2><p>운용 적격 0개 · NO_ELIGIBLE_STRATEGY</p>
    <p class="note">미국의 각 외부 연도 전에 학습 5년과 내부 평가 1년으로 후보를 선택한 메타전략입니다. 고정 전략 순위와 구분합니다.</p>
    ${table(["학습","내부","외부","외부 보유 대비 CAGR"],report.nested.map(r=>[r.train_start+"–"+r.train_end,r.inner,r.outer,pp(r.outer_excess_cagr)]))}
    <p class="line note">개발 순위에서 잠근 ${report.overview.final_candidates}개 고유 후보를 이후 과거 구간에서 점검했습니다.
     전체 데이터에 선행 연구 노출이 있어 독립 최종 검증 기준은 증거 부족입니다.</p></section></div>`;
}
function account() {
  const data=report.portfolio;
  return `<section class="panel"><h2>원화 모의 계좌</h2><p class="note">고정 40주선 전략·정기 매수·현금 보유에 같은 납입을 적용한 세전 비교입니다. 예시 계좌 설정입니다.</p>
   ${table(["정책","TWR","TWR MDD","XIRR","납입액","비용"],Object.entries(data).map(([k,v])=>[modeNames[k],pct(v.twr),pct(v.mdd),pct(v.xirr),num(v.contributed)+"원",num(v.fees)+"원"]))}
   ${chart(Object.fromEntries(Object.entries(data).map(([k,v])=>[modeNames[k],v.curve])),"납입 조정 누적 수익 지수")}</section>`;
}
function live() {
  return `<section class="panel"><h2>최신 확정 신호</h2><p>배포 승인된 전략 0개</p><p>보존 자료 마지막 확정 주 ${esc(report.paper.observed_session)}</p>
    <p class="line">STALE · 최신 확정 봉 확인 대기 · 예정 체결 0개</p></section>`;
}
function coverage() {
  return `<section class="panel"><h2>데이터와 평가 범위</h2><p>${report.overview.assets}종 확보 · 초기 확대 목표 ${report.overview.target_assets}종
   · 봉인 전 기준일 ${esc(report.overview.asof)}</p>
    <p class="note">보존 시세에서 고른 현재 생존 종목 표본입니다. 과거 전체 구성과 상장폐지 자료가 필요합니다.</p>
    ${table(["종목","시장","군집","첫 날짜","일봉"],report.dataset.map(r=>[r.symbol,r.market,r.cluster,r.first_observation,r.sessions]))}
    <p class="line note">입력 버전 ${esc(report.overview.data_version)} · 설정 버전 ${esc(report.overview.config_version)}</p>
    <p class="note">일봉은 200일선 보조 특성까지 계산했습니다. 순위는 주봉 연구입니다. 배당은 현금 권리와 지급을 분리했고 지급일 미확인분은 7일로 가정했습니다.</p>
    <div class="tags pane"><a href="strategy_rankings.csv" download>순위 CSV</a> · <a href="strategies.json" download>전략 명세</a></div></section>`;
}
function render() {
  el("nav").innerHTML=Object.entries(pages).map(([key,title])=>`<button data-view="${key}" aria-selected="${state.view===key}">${title}</button>`).join("");
  const views={rank,signals,regimes,validation,portfolio:account,live,data:coverage};
  el("content").innerHTML=(views[state.view]||rank)();
  updateHash();
  if (state.view==="signals"&&!aux) fetch("signals.json").then(r=>{if(!r.ok)throw Error();return r.json();}).then(v=>{aux=v;render();})
    .catch(()=>{el("content").textContent="신호 요약을 불러올 수 없습니다. 다시 열어 주세요.";});
}
el("nav").addEventListener("click",event=>{const b=event.target.closest("[data-view]");if(!b)return;state.view=b.dataset.view;render();});
el("content").addEventListener("change",event=>{const key=event.target.dataset.state;if(!key)return;state[key]=event.target.value;state.page=0;render();});
el("content").addEventListener("click",event=>{
  const b=event.target.closest("button");
  if (!b) return;
  const d=b.dataset;
  if (d.scope) {state.scope=d.scope;state.cluster="all";state.id="";state.page=0;}
  else if (d.mode) {state.mode=d.mode;state.page=0;}
  else if (d.strategy) state.id=d.strategy;
  else if (d.page) {state.page=Number(state.page)+Number(d.page);state.id="";}
  else if (d.jump) {
    state.view="rank";state.id=d.jump;state.family="all";state.regime="all";state.cluster="all";state.mode="research";
    state.profile="Balanced";state.page=Math.floor(report.panels[state.scope].rows.findIndex(r=>r.strategy_id===d.jump)/12);
  } else return;
  render();
  if ((d.strategy||d.jump)&&window.matchMedia("(max-width: 800px)").matches) {
    el("detail")?.focus({preventScroll:true});el("detail")?.scrollIntoView();
  }
});
window.addEventListener("hashchange",()=>{readHash();if (report) render();});
fetch("data.json").then(response=>{if(!response.ok)throw Error();return response.json();}).then(data=>{
  report=data;readHash();
  const o=data.overview;
  el("subtitle").textContent="완결된 주봉 전략 · 연구 자료 기준 "+o.asof;
  el("overview").innerHTML=[["종목",o.assets],["전략",o.strategies],["실험 평가",o.evaluations],["운용 적격",o.eligible]]
    .map(([k,v])=>`<div class="card"><small>${k}</small><strong>${num(v)}</strong></div>`).join("");
  render();
}).catch(()=>{el("content").textContent="데이터를 읽을 수 없습니다. 페이지를 다시 열어 주세요.";});
