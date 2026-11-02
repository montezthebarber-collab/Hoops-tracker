import { useState, useEffect, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── SUPABASE CLIENT ──────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── THEME ────────────────────────────────────────────────────────────────────
const T = {
  red:       "#CE1141",   // Bulls red
  redDark:   "#A50E33",   // darker red
  redDim:    "#CE114122", // transparent red
  redBorder: "#CE114155",
  bg:        "#080808",   // near-black background
  bgCard:    "#111111",   // card background
  bgInput:   "#181818",   // input background
  border:    "#1e1e1e",
  border2:   "#2a2a2a",
  text:      "#ffffff",
  textMuted: "#888888",
  textDim:   "#444444",
  green:     "#22c55e",
  greenDim:  "#22c55e22",
  yellow:    "#eab308",
  blue:      "#3b82f6",
};

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const STAT_FIELDS = [
  {key:"pts",label:"PTS"},{key:"fgm",label:"FGM"},{key:"fga",label:"FGA"},
  {key:"tpm",label:"3PM"},{key:"tpa",label:"3PA"},{key:"ftm",label:"FTM"},
  {key:"fta",label:"FTA"},{key:"oreb",label:"ORB"},{key:"dreb",label:"DRB"},
  {key:"ast",label:"AST"},{key:"stl",label:"STL"},{key:"blk",label:"BLK"},
  {key:"tov",label:"TOV"},{key:"pf",label:"PF"},
];
const BOX_COLS   = ["pts","fgm","fga","tpm","tpa","ftm","fta","oreb","dreb","ast","stl","blk","tov","pf"];
const ANOMALY    = {pts:35,ast:12,stl:7,blk:7};
const J_COLORS   = [T.red,"#3b82f6","#22c55e","#a855f7","#ec4899","#eab308","#06b6d4","#f43f5e"];
const emptyStats = () => Object.fromEntries(STAT_FIELDS.map(f=>[f.key,""]));
const newId      = p  => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
const today      = () => new Date().toISOString().slice(0,10);
const MONTHS     = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const monthShort = d  => { try { return MONTHS[new Date(d+"T12:00:00").getMonth()]; } catch { return ""; } };
const formatDate = d  => { try { const dt=new Date(d+"T12:00:00"); return `${MONTHS[dt.getMonth()]} ${dt.getDate()}, ${dt.getFullYear()}`; } catch { return d; } };

// ─── DB ROW TRANSFORMERS ──────────────────────────────────────────────────────
const logFromDB = l => ({ ...l, playerId: l.player_id, gameId: l.game_id });
const logToDB   = l => { const { playerId, gameId, ...rest } = l; return { ...rest, player_id: playerId, game_id: gameId }; };

// ─── ANALYTICS ────────────────────────────────────────────────────────────────
const calcTS  = (p,a,f) => { const t=a+0.44*f; return t>0?p/(2*t):0; };
const calcEFG = (m,tp,a) => a>0?(m+0.5*tp)/a:0;
const calcATO = (a,t)   => t>0?a/t:a>0?999:0;
const calcPER = (t,gp)  => !gp?0:(t.pts+0.5*t.ast+t.oreb+0.7*t.dreb+t.stl+0.7*t.blk
  -0.7*(t.fga-t.fgm)-0.4*(t.fta-t.ftm)-t.tov-0.4*t.pf)/gp;

function getPlayerStats(pid, logs) {
  const pl = logs.filter(g=>g.playerId===pid);
  if (!pl.length) return null;
  const t = Object.fromEntries(STAT_FIELDS.map(f=>[f.key,0]));
  for (const l of pl) for (const k of Object.keys(t)) t[k]+=(Number(l[k])||0);
  const gp = pl.length;
  return {
    gp, totals:t,
    avgs: Object.fromEntries(Object.entries(t).map(([k,v])=>[k,v/gp])),
    ts:calcTS(t.pts,t.fga,t.fta), efg:calcEFG(t.fgm,t.tpm,t.fga),
    ato:calcATO(t.ast,t.tov), per:calcPER(t,gp),
    fgpct:t.fga>0?t.fgm/t.fga:0, tppct:t.tpa>0?t.tpm/t.tpa:0,
    ftpct:t.fta>0?t.ftm/t.fta:0, logs:pl,
  };
}

function flagStats(row) {
  const f={};
  if(Number(row.fgm)>Number(row.fga)) f.fgm="Makes>Att";
  if(Number(row.tpm)>Number(row.tpa)) f.tpm="Makes>Att";
  if(Number(row.ftm)>Number(row.fta)) f.ftm="Makes>Att";
  if(Number(row.tpm)>Number(row.fgm)) f.tpm="3PM>FGM";
  if(Number(row.pts)>ANOMALY.pts)     f.pts=`High (>${ANOMALY.pts})`;
  if(Number(row.ast)>ANOMALY.ast)     f.ast="High for rec";
  if(Number(row.stl)>ANOMALY.stl)     f.stl="High for rec";
  if(Number(row.blk)>ANOMALY.blk)     f.blk="High for rec";
  return f;
}

// ─── REAL-TIME DATA HOOK ──────────────────────────────────────────────────────
function useAppData() {
  const [players, setPlayers] = useState([]);
  const [games,   setGames]   = useState([]);
  const [logs,    setLogs]    = useState([]);
  const [ready,   setReady]   = useState(false);
  const [syncStatus, setSyncStatus] = useState("connecting");
  const [dbError, setDbError] = useState(null);

  const loadPlayers = useCallback(async () => { const {data,error}=await supabase.from("players").select("*").order("created_at"); if(error){ setDbError("Can't reach the database: "+error.message); return; } if(data){ setPlayers(data); } },[]);
  const loadGames   = useCallback(async () => { const {data,error}=await supabase.from("games").select("*").order("date",{ascending:false}); if(error){ setDbError("Can't reach the database: "+error.message); return; } if(data){ setGames(data); } },[]);
  const loadLogs    = useCallback(async () => { const {data,error}=await supabase.from("gamelogs").select("*"); if(error){ setDbError("Can't reach the database: "+error.message); return; } if(data){ setLogs(data.map(logFromDB)); } },[]);
  const reloadAll   = useCallback(() => Promise.all([loadPlayers(),loadGames(),loadLogs()]),[loadPlayers,loadGames,loadLogs]);

  // Runs DB writes in order; on any failure shows a banner, reloads the true DB state, and returns false.
  const runWrites = async (steps) => {
    for (const step of steps) {
      const res = await step();
      if (res && res.error) {
        setDbError("NOT SAVED — database refused the change: "+res.error.message);
        await reloadAll();
        return false;
      }
    }
    setDbError(null);
    return true;
  };

  useEffect(() => {
    Promise.all([loadPlayers(),loadGames(),loadLogs()]).then(()=>setReady(true)).catch(e=>{ setDbError("Can't reach the database: "+e.message); setSyncStatus("error"); setReady(true); });
    const channel = supabase.channel("db-all-changes")
      .on("postgres_changes",{event:"*",schema:"public",table:"players"},  ()=>loadPlayers())
      .on("postgres_changes",{event:"*",schema:"public",table:"games"},    ()=>loadGames())
      .on("postgres_changes",{event:"*",schema:"public",table:"gamelogs"}, ()=>loadLogs())
      .subscribe(status=>setSyncStatus(status==="SUBSCRIBED"?"live":status==="CLOSED"?"error":"connecting"));
    return ()=>supabase.removeChannel(channel);
  },[loadPlayers,loadGames,loadLogs]);

  const savePlayers = async newArr => {
    const toDelete=players.filter(p=>!newArr.find(np=>np.id===p.id));
    const ok = await runWrites([
      ()=> toDelete.length ? supabase.from("players").delete().in("id",toDelete.map(p=>p.id)) : null,
      ()=> newArr.length ? supabase.from("players").upsert(newArr.map(({id,name,number})=>({id,name,number}))) : null,
    ]);
    if(ok) setPlayers(newArr);
    return ok;
  };

  const saveGames = async newArr => {
    const toDelete=games.filter(g=>!newArr.find(ng=>ng.id===g.id));
    const ok = await runWrites([
      ()=> toDelete.length ? supabase.from("games").delete().in("id",toDelete.map(g=>g.id)) : null,
      ()=> newArr.length ? supabase.from("games").upsert(newArr.map(({id,date,opponent,result})=>({id,date,opponent,result}))) : null,
    ]);
    if(ok) setGames(newArr);
    return ok;
  };

  const saveLogs = async newArr => {
    const toDelete=logs.filter(l=>!newArr.find(nl=>nl.id===l.id));
    const ok = await runWrites([
      ()=> toDelete.length ? supabase.from("gamelogs").delete().in("id",toDelete.map(l=>l.id)) : null,
      ()=> newArr.length ? supabase.from("gamelogs").upsert(newArr.map(l=>{ const {created_at,...rest}=logToDB(l); return rest; })) : null,
    ]);
    if(ok) setLogs(newArr);
    return ok;
  };

  return { players,games,logs,ready,syncStatus,dbError,setDbError,savePlayers,saveGames,saveLogs };
}

// ─── SHARED UI ────────────────────────────────────────────────────────────────
const Card       = ({children,style={}}) => <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:16,padding:18,...style}}>{children}</div>;
const SectionLbl = ({children})          => <div style={{fontSize:11,fontWeight:700,color:T.red,textTransform:"uppercase",letterSpacing:1.2,marginBottom:12}}>{children}</div>;
const Field      = ({label,children})    => <div style={{marginBottom:4}}><div style={{fontSize:11,color:T.textMuted,marginBottom:5}}>{label}</div>{children}</div>;
const Empty      = ({icon,title,sub})    => (
  <div style={{textAlign:"center",padding:"70px 20px"}}>
    <div style={{fontSize:52,marginBottom:14}}>{icon}</div>
    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:22,color:T.textDim,letterSpacing:1,marginBottom:6}}>{title}</div>
    <div style={{color:"#444",fontSize:13,lineHeight:1.6}}>{sub}</div>
  </div>
);
const Centered = ({children}) => (
  <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 20px",textAlign:"center"}}>{children}</div>
);
const Spinner = ({label,sub}) => (
  <Centered>
    <div className="buckets-spinner" style={{marginBottom:20}}/>
    <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:26,color:T.red,letterSpacing:2}}>{label}</div>
    {sub&&<div style={{color:T.textMuted,fontSize:13,marginTop:6}}>{sub}</div>}
  </Centered>
);
const SubHeader = ({title,sub,showBack,onBack,right}) => (
  <div style={{background:"#0d0d0d",borderBottom:`1px solid ${T.border}`,padding:"14px 18px",flexShrink:0}}>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {showBack&&<button onClick={onBack} style={{background:"none",border:"none",color:T.red,fontSize:24,cursor:"pointer",padding:"0 8px 0 0",lineHeight:1}}>‹</button>}
        <div>
          <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:22,color:T.red,letterSpacing:1,lineHeight:1}}>{title}</div>
          {sub&&<div style={{fontSize:11,color:T.textDim,marginTop:1}}>{sub}</div>}
        </div>
      </div>
      {right}
    </div>
  </div>
);

// ─── SYNC DOT ─────────────────────────────────────────────────────────────────
function SyncDot({ status }) {
  const colors = {live:T.green,connecting:T.red,error:"#ef4444"};
  const labels = {live:"Live",connecting:"Syncing…",error:"Offline"};
  return (
    <div style={{display:"flex",alignItems:"center",gap:5}}>
      <div style={{width:7,height:7,borderRadius:"50%",background:colors[status]||"#555",
        boxShadow:status==="live"?`0 0 0 2px ${T.green}33`:"none",
        animation:status==="connecting"?"pulse 1.5s infinite":"none"}}/>
      <span style={{fontSize:10,color:colors[status]||"#555",fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>
        {labels[status]||status}
      </span>
    </div>
  );
}

// ─── IMAGE COMPRESSION (keeps uploads under Vercel's 4.5MB limit) ────────────
function compressImage(file, maxDim=1600, quality=0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL("image/jpeg", quality);
      resolve({ dataUrl, b64: dataUrl.split(",")[1], mime: "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
    img.src = url;
  });
}

// ─── FILE IMPORT (CSV) — for records that can't be scanned ───────────────────
function parseCSV(text) {
  const rows=[]; let row=[], cur="", q=false;
  for (let i=0;i<text.length;i++) {
    const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else if(c==='"') q=true;
    else if(c===","||c==="\t"||c===";"){ row.push(cur); cur=""; }
    else if(c==="\n"||c==="\r"){ if(c==="\r"&&text[i+1]==="\n") i++; row.push(cur); cur=""; if(row.some(x=>x.trim()!=="")) rows.push(row); row=[]; }
    else cur+=c;
  }
  row.push(cur); if(row.some(x=>x.trim()!=="")) rows.push(row);
  return rows;
}
const COL_ALIASES = {
  name:["name","player","playername","player name"], number:["number","#","no","jersey","num"],
  pts:["pts","points","pt"], fgm:["fgm","fg made"], fga:["fga","fg att","fg attempts"],
  tpm:["3pm","tpm","3p made","threes made","3ptm"], tpa:["3pa","tpa","3p att","threes att","3pta"],
  ftm:["ftm","ft made"], fta:["fta","ft att","ft attempts"],
  oreb:["oreb","orb","off reb","offensive rebounds"], dreb:["dreb","drb","def reb","defensive rebounds"],
  ast:["ast","assists","a"], stl:["stl","steals","st"], blk:["blk","blocks","bl"],
  tov:["tov","to","turnovers","tos"], pf:["pf","fouls","foul"],
  date:["date","game date"], opponent:["opponent","opp","vs"], result:["result","score","final"],
};
function mapImportedRows(table) {
  if(table.length<2) throw new Error("The file needs a header row and at least one player row.");
  const norm = h => h.toLowerCase().replace(/[^a-z0-9# ]/g,"").trim();
  const header = table[0].map(norm);
  const idx = {}; 
  for (const [key,aliases] of Object.entries(COL_ALIASES)) {
    const i = header.findIndex(h=>aliases.map(a=>a.replace(/[^a-z0-9# ]/g,"")).includes(h));
    if(i>=0) idx[key]=i;
  }
  if(idx.name===undefined) throw new Error("Couldn't find a Name/Player column. Use the template for the exact column names.");
  const players = table.slice(1).filter(r=>(r[idx.name]||"").trim()).map(r=>{
    const o={...emptyStats(),name:r[idx.name].trim(),number:idx.number!==undefined?(r[idx.number]||"").trim():""};
    for (const f of STAT_FIELDS) if(idx[f.key]!==undefined){ const n=parseFloat((r[idx[f.key]]||"").trim()); o[f.key]=isNaN(n)?"":n; }
    return o;
  });
  if(!players.length) throw new Error("No player rows found under the header.");
  const first = table[1]; const game={};
  for (const k of ["date","opponent","result"]) if(idx[k]!==undefined && (first[idx[k]]||"").trim()) game[k]=first[idx[k]].trim();
  return { players, game };
}
const TEMPLATE_CSV = "Name,Number,PTS,FGM,FGA,3PM,3PA,FTM,FTA,OREB,DREB,AST,STL,BLK,TOV,PF,Date,Opponent,Result\nMarcus Johnson,23,12,5,11,1,3,1,2,1,4,3,1,0,2,2,2026-11-01,Red Devils,W 62-54\nJohn Smith,7,8,3,8,0,2,2,2,0,3,5,2,0,1,3,,,\n";

// ─── OCR (calls your secure server function — no key in the browser) ─────────
async function runOCR(b64, mime) {
  const res = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: b64, mime }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Scan failed (${res.status})`);
  return data.stats;
}

// ─── MODULE: SCANNER ─────────────────────────────────────────────────────────
function Scanner({ players, games, logs, savePlayers, saveGames, saveLogs, onDone }) {
  const [step,setStep]     = useState("upload");
  const [preview,setPrev]  = useState(null);
  const [b64,setB64]       = useState(null);
  const [mime,setMime]     = useState("image/jpeg");
  const [rows,setRows]     = useState([]);
  const [flags,setFlags]   = useState([]);
  const [gameInfo,setGame] = useState({date:today(),opponent:"",result:""});
  const [err,setErr]       = useState(null);
  const fileRef = useRef();
  const dataRef = useRef();

  const handleDataFile = async f => {
    if(!f) return;
    try {
      const text = await f.text();
      const { players:imported, game } = mapImportedRows(parseCSV(text.replace(/^\uFEFF/,"")));
      setRows(imported); setFlags(imported.map(r=>flagStats(r)));
      setGame(g=>({ date:game.date||g.date, opponent:g.opponent||game.opponent||"", result:g.result||game.result||"" }));
      setErr(null); setStep("review");
    } catch(e) { setErr("Import failed: "+e.message); }
    if(dataRef.current) dataRef.current.value="";
  };
  const startManual = () => { setRows([{name:"",number:"",...emptyStats()}]); setFlags([{}]); setErr(null); setStep("review"); };
  const downloadTemplate = () => {
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([TEMPLATE_CSV],{type:"text/csv"}));
    a.download="getting-buckets-template.csv"; document.body.appendChild(a); a.click(); a.remove();
  };

  const handleFile = async f => {
    if(!f) return;
    try {
      const { dataUrl, b64, mime } = await compressImage(f);
      setPrev(dataUrl); setB64(b64); setMime(mime); setStep("ready");
    } catch(e) { setErr("Couldn't read that image: "+e.message); }
  };

  const scan = async () => {
    setStep("scanning"); setErr(null);
    try {
      const ext=await runOCR(b64,mime);
      const enriched=ext.map(r=>({...emptyStats(),...r,name:r.name||"",number:r.number||""}));
      setRows(enriched); setFlags(enriched.map(r=>flagStats(r))); setStep("review");
    } catch(e) { setErr("Scan failed: "+e.message); setStep("ready"); }
  };

  const updateCell = (ri,key,val) => {
    const next=rows.map((r,i)=>i===ri?{...r,[key]:val}:r);
    setRows(next); setFlags(next.map(r=>flagStats(r)));
  };

  const save = async () => {
    setStep("saving");
    try {
      const gameId=newId("g");
      let updPl=[...players];
      const newLogs=[];
      for (const row of rows) {
        if(!row.name.trim()) continue;
        let p=updPl.find(p=>p.name.toLowerCase()===row.name.toLowerCase());
        if(!p){ p={id:newId("p"),name:row.name.trim(),number:row.number}; updPl.push(p); }
        newLogs.push({id:newId("gl"),playerId:p.id,gameId,...Object.fromEntries(STAT_FIELDS.map(f=>[f.key,Number(row[f.key])||0]))});
      }
      if(!(await savePlayers(updPl)))  throw new Error("players were not saved");
      if(!(await saveGames([...games,{id:gameId,date:gameInfo.date,opponent:gameInfo.opponent,result:gameInfo.result}]))) throw new Error("game was not saved");
      if(!(await saveLogs([...logs,...newLogs]))) throw new Error("player stats were not saved");
      setStep("done");
    } catch(e) { setErr("Save failed: "+e.message); setStep("review"); }
  };

  const reset = () => { setStep("upload"); setPrev(null); setB64(null); setRows([]); setFlags([]); setErr(null); setGame({date:today(),opponent:"",result:""}); };
  const totalFlags=flags.reduce((s,f)=>s+Object.keys(f).length,0);

  if(step==="scanning") return <Spinner label="SCANNING..." sub="Claude Vision is reading your scoresheet"/>;
  if(step==="saving")   return <Spinner label="SAVING..." sub="Syncing to shared database"/>;

  if(step==="done") return (
    <Centered>
      <div style={{fontSize:64,marginBottom:12}}>🏀</div>
      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:30,color:T.red,letterSpacing:2,marginBottom:8}}>STATS SAVED!</div>
      <div style={{color:T.textMuted,fontSize:14,marginBottom:10,lineHeight:1.7}}>
        {rows.filter(r=>r.name.trim()).length} players · <strong style={{color:T.text}}>{gameInfo.opponent||"game"}</strong> · {gameInfo.date}
      </div>
      <div style={{color:T.green,fontSize:12,marginBottom:28}}>✓ Synced to all devices</div>
      <div style={{display:"flex",gap:10}}>
        <button className="btn-ghost" onClick={reset}>Scan Another</button>
        <button className="btn-primary" onClick={()=>onDone("games")}>View Games →</button>
      </div>
    </Centered>
  );

  return (
    <div className="module-scroll">
      {err&&<div className="alert-red">⚠ {err} <button onClick={()=>setErr(null)} style={{float:"right",background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:16}}>×</button></div>}

      {(step==="upload"||step==="ready")&&<>
        <Card style={{marginBottom:14}}>
          <SectionLbl>Game Details</SectionLbl>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="Date"><input type="date" value={gameInfo.date} onChange={e=>setGame(g=>({...g,date:e.target.value}))} className="text-input"/></Field>
            <Field label="Opponent"><input type="text" value={gameInfo.opponent} placeholder="Team name" onChange={e=>setGame(g=>({...g,opponent:e.target.value}))} className="text-input"/></Field>
            <div style={{gridColumn:"span 2"}}>
              <Field label="Result (e.g. W 62-54)"><input type="text" value={gameInfo.result} placeholder="W 62-54" onChange={e=>setGame(g=>({...g,result:e.target.value}))} className="text-input" style={{width:"100%"}}/></Field>
            </div>
          </div>
        </Card>
        <div className={`drop-zone${preview?" drop-zone--filled":""}`}
          onClick={()=>fileRef.current.click()}
          onDrop={e=>{e.preventDefault();handleFile(e.dataTransfer.files[0]);}}
          onDragOver={e=>e.preventDefault()}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])}/>
          {preview
            ? <><img src={preview} alt="scoresheet" style={{maxHeight:200,maxWidth:"100%",borderRadius:12,marginBottom:10,objectFit:"contain"}}/><div style={{fontSize:13,color:T.red,fontWeight:600}}>✓ Image loaded — tap to replace</div></>
            : <><div style={{fontSize:48,marginBottom:8}}>📸</div><div style={{fontSize:16,fontWeight:600,marginBottom:4}}>Tap to photograph scoresheet</div><div style={{fontSize:13,color:T.textMuted}}>or drag & drop an image</div></>
          }
        </div>
        {step==="ready"&&<button className="btn-primary btn-full" onClick={scan}>🔍 SCAN SCORESHEET</button>}

        <Card style={{marginTop:14}}>
          <SectionLbl>Can't scan it?</SectionLbl>
          <div style={{fontSize:12,color:T.textMuted,lineHeight:1.6,marginBottom:12}}>Import a stats file or type the numbers in. You'll review everything before it saves.</div>
          <input ref={dataRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" style={{display:"none"}} onChange={e=>handleDataFile(e.target.files[0])}/>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <button className="btn-ghost btn-full" onClick={()=>dataRef.current.click()}>📄 Import stats file (CSV)</button>
            <button className="btn-ghost btn-full" onClick={startManual}>✍️ Enter stats manually</button>
            <button onClick={downloadTemplate} style={{background:"none",border:"none",color:T.red,fontSize:12,cursor:"pointer",padding:"4px 0",textDecoration:"underline"}}>Download CSV template</button>
          </div>
        </Card>
      </>}

      {step==="review"&&<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div><div style={{fontFamily:"'Bebas Neue',cursive",fontSize:20,letterSpacing:1}}>REVIEW STATS</div><div style={{fontSize:12,color:T.textMuted}}>{rows.length} players extracted</div></div>
          {totalFlags>0&&<span className="badge badge-red">⚠ {totalFlags} flag{totalFlags>1?"s":""}</span>}
        </div>
        {rows.map((row,ri)=>{
          const rf=flags[ri]||{};
          return (
            <Card key={ri} style={{marginBottom:10,border:`1px solid ${Object.keys(rf).length?"#ef444455":T.border}`}}>
              <div style={{display:"flex",gap:8,marginBottom:10,alignItems:"center"}}>
                <div className="jersey-badge" style={{background:T.red}}>{row.number||"?"}</div>
                <input value={row.name} placeholder="Player name" onChange={e=>updateCell(ri,"name",e.target.value)} style={{flex:1,background:T.bgInput,border:`1px solid ${T.border2}`,borderRadius:8,color:T.text,padding:"7px 10px",fontSize:15,fontWeight:600}}/>
                <input value={row.number} placeholder="#" onChange={e=>updateCell(ri,"number",e.target.value)} style={{width:44,background:T.bgInput,border:`1px solid ${T.border2}`,borderRadius:8,color:T.text,padding:"7px 5px",fontSize:14,textAlign:"center"}}/>
                <button onClick={()=>{setRows(r=>r.filter((_,i)=>i!==ri));setFlags(f=>f.filter((_,i)=>i!==ri));}} style={{background:"none",border:"none",color:"#555",fontSize:20,cursor:"pointer",padding:"4px",lineHeight:1}}>×</button>
              </div>
              <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                {STAT_FIELDS.map(f=>(
                  <div key={f.key} style={{textAlign:"center"}}>
                    <div style={{fontSize:9,color:rf[f.key]?"#ef4444":T.textDim,marginBottom:3,fontWeight:700,textTransform:"uppercase"}}>{f.label}</div>
                    <input type="number" min="0" value={row[f.key]} onChange={e=>updateCell(ri,f.key,e.target.value)} style={{width:44,background:rf[f.key]?"#1f0e0e":T.bgInput,border:`1px solid ${rf[f.key]?"#ef4444":T.border2}`,borderRadius:7,color:T.text,padding:"5px 3px",textAlign:"center",fontSize:13}}/>
                  </div>
                ))}
              </div>
              {Object.entries(rf).length>0&&<div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:5}}>{Object.entries(rf).map(([k,msg])=><span key={k} className="badge badge-red">{STAT_FIELDS.find(f=>f.key===k)?.label}: {msg}</span>)}</div>}
            </Card>
          );
        })}
        <button className="btn-ghost btn-full" style={{marginBottom:10}} onClick={()=>{setRows(r=>[...r,{name:"",number:"",...emptyStats()}]);setFlags(f=>[...f,{}]);}}>+ Add Player Manually</button>
        <button className="btn-primary btn-full" onClick={save}>💾 SAVE & SYNC TO ALL DEVICES</button>
      </>}
    </div>
  );
}

// ─── MODULE: GAMES MANAGER ────────────────────────────────────────────────────
function GamesManager({ players, games, logs, saveGames, saveLogs }) {
  const [view,setView]             = useState("list");
  const [selGame,setSelGame]       = useState(null);
  const [form,setForm]             = useState({date:today(),opponent:"",result:""});
  const [editForm,setEditForm]     = useState(null);
  const [saving,setSaving]         = useState(false);
  const [delConfirm,setDelConfirm] = useState(false);

  const openDetail = g => { setSelGame(g); setView("detail"); setDelConfirm(false); };
  const goBack     = () => { setView(view==="detail"?"list":view==="editInfo"?"detail":"list"); setDelConfirm(false); };

  const addGame = async () => {
    if(!form.opponent.trim()) return; setSaving(true);
    await saveGames([...games,{id:newId("g"),date:form.date,opponent:form.opponent.trim(),result:form.result.trim()}]);
    setSaving(false); setView("list");
  };
  const saveEdit = async () => {
    setSaving(true);
    await saveGames(games.map(g=>g.id===editForm.id?editForm:g));
    setSelGame(editForm); setSaving(false); setView("detail");
  };
  const deleteGame = async id => {
    await saveGames(games.filter(g=>g.id!==id));
    await saveLogs(logs.filter(l=>l.gameId!==id));
    setView("list"); setDelConfirm(false);
  };

  const getBoxScore = gameId => {
    const gl=logs.filter(l=>l.gameId===gameId);
    const rows=gl.map(l=>{ const p=players.find(p=>p.id===l.playerId); return {...l,playerName:p?.name||"Unknown",playerNumber:p?.number||"?"}; }).sort((a,b)=>(b.pts||0)-(a.pts||0));
    const totals=Object.fromEntries(BOX_COLS.map(k=>[k,rows.reduce((s,r)=>s+(Number(r[k])||0),0)]));
    return {rows,totals};
  };

  const resultColor = r => { if(!r) return T.textDim; const u=r.trim().toUpperCase(); if(u.startsWith("W")) return T.green; if(u.startsWith("L")) return "#ef4444"; return T.red; };
  const sorted=[...games].sort((a,b)=>b.date.localeCompare(a.date));

  if(view==="list") return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <SubHeader title="🗓 GAMES" sub={`${games.length} game${games.length!==1?"s":""} this season`}
        right={<button className="btn-primary" style={{padding:"7px 14px",fontSize:13}} onClick={()=>{setForm({date:today(),opponent:"",result:""});setView("add");}}>+ Add</button>}/>
      <div className="module-scroll">
        {sorted.length===0 ? <Empty icon="🗓" title="NO GAMES YET" sub="Add a game manually or scan a scoresheet"/>
          : sorted.map(g=>{
              const {rows,totals}=getBoxScore(g.id); const rc=resultColor(g.result);
              return (
                <div key={g.id} className="list-row" onClick={()=>openDetail(g)}>
                  <div style={{width:5,background:rc,alignSelf:"stretch",flexShrink:0}}/>
                  <div style={{flex:1,padding:"14px 12px",display:"flex",alignItems:"center",gap:12}}>
                    <div style={{textAlign:"center",flexShrink:0,minWidth:36}}>
                      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:22,color:T.red,lineHeight:1}}>{g.date?g.date.slice(8):"—"}</div>
                      <div style={{fontSize:9,color:T.textDim,textTransform:"uppercase"}}>{g.date?monthShort(g.date):""}</div>
                    </div>
                    <div style={{width:1,background:T.border,alignSelf:"stretch"}}/>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:700,fontSize:15,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{g.opponent||"Unknown Opponent"}</div>
                      <div style={{fontSize:12,color:T.textMuted,marginTop:2,display:"flex",gap:10}}>
                        <span>{rows.length} player{rows.length!==1?"s":""}</span>
                        {totals.pts>0&&<span style={{color:"#888"}}>{totals.pts} team pts</span>}
                      </div>
                    </div>
                    {g.result ? <div style={{background:`${rc}22`,color:rc,border:`1px solid ${rc}44`,borderRadius:8,padding:"4px 10px",fontSize:12,fontWeight:700,whiteSpace:"nowrap",flexShrink:0}}>{g.result}</div>
                              : <div style={{color:T.border,fontSize:12,flexShrink:0}}>—</div>}
                    <div style={{color:T.border,fontSize:18}}>›</div>
                  </div>
                </div>
              );
          })
        }
      </div>
    </div>
  );

  if(view==="add") return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <SubHeader title="NEW GAME" showBack onBack={goBack}/>
      <div className="module-scroll">
        <Card>
          <SectionLbl>Game Details</SectionLbl>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Field label="Date *"><input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} className="text-input"/></Field>
            <Field label="Opponent *"><input type="text" value={form.opponent} placeholder="e.g. Red Devils" onChange={e=>setForm(f=>({...f,opponent:e.target.value}))} className="text-input"/></Field>
            <Field label="Result (optional)"><input type="text" value={form.result} placeholder="e.g. W 68-54" onChange={e=>setForm(f=>({...f,result:e.target.value}))} className="text-input"/></Field>
          </div>
          <div style={{marginTop:20,display:"flex",gap:10}}>
            <button className="btn-ghost" style={{flex:1}} onClick={goBack}>Cancel</button>
            <button className="btn-primary" style={{flex:2}} onClick={addGame} disabled={!form.opponent.trim()||saving}>{saving?"SAVING...":"CREATE GAME"}</button>
          </div>
        </Card>
      </div>
    </div>
  );

  if(view==="editInfo"&&editForm) return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <SubHeader title="EDIT GAME" showBack onBack={goBack}/>
      <div className="module-scroll">
        <Card>
          <SectionLbl>Game Details</SectionLbl>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Field label="Date"><input type="date" value={editForm.date} onChange={e=>setEditForm(f=>({...f,date:e.target.value}))} className="text-input"/></Field>
            <Field label="Opponent"><input type="text" value={editForm.opponent} onChange={e=>setEditForm(f=>({...f,opponent:e.target.value}))} className="text-input"/></Field>
            <Field label="Result"><input type="text" value={editForm.result} placeholder="e.g. W 68-54" onChange={e=>setEditForm(f=>({...f,result:e.target.value}))} className="text-input"/></Field>
          </div>
          <div style={{marginTop:20,display:"flex",gap:10}}>
            <button className="btn-ghost" style={{flex:1}} onClick={goBack}>Cancel</button>
            <button className="btn-primary" style={{flex:2}} onClick={saveEdit} disabled={saving}>{saving?"SAVING...":"SAVE CHANGES"}</button>
          </div>
        </Card>
      </div>
    </div>
  );

  if(view==="detail"&&selGame) {
    const {rows:boxRows,totals}=getBoxScore(selGame.id); const rc=resultColor(selGame.result);
    return (
      <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
        <SubHeader title="BOX SCORE" showBack onBack={goBack}
          right={<div style={{display:"flex",gap:6}}>
            <button className="btn-ghost" style={{padding:"7px 11px",fontSize:13}} onClick={()=>{setEditForm({...selGame});setView("editInfo");}}>✏️</button>
            <button className="btn-ghost" style={{padding:"7px 11px",fontSize:13,borderColor:delConfirm?"#ef4444":T.border2,color:delConfirm?"#ef4444":T.textMuted}}
              onClick={()=>{ if(delConfirm) deleteGame(selGame.id); else setDelConfirm(true); }}>{delConfirm?"CONFIRM ⚠":"🗑"}</button>
          </div>}/>
        <div className="module-scroll">
          <div style={{background:`linear-gradient(135deg,#130005,${T.bgCard})`,border:`1px solid ${rc}33`,borderRadius:18,padding:18,marginBottom:16,position:"relative",overflow:"hidden"}}>
            <div style={{position:"absolute",top:0,left:0,width:5,bottom:0,background:rc}}/>
            <div style={{paddingLeft:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                <div><div style={{fontFamily:"'Bebas Neue',cursive",fontSize:26,letterSpacing:1,lineHeight:1}}>{selGame.opponent||"Unknown"}</div><div style={{fontSize:13,color:T.textMuted,marginTop:3}}>{formatDate(selGame.date)}</div></div>
                {selGame.result&&<div style={{background:`${rc}22`,color:rc,border:`1px solid ${rc}55`,borderRadius:10,padding:"6px 14px",fontFamily:"'Bebas Neue',cursive",fontSize:22,letterSpacing:1}}>{selGame.result}</div>}
              </div>
              <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
                {[["Players",boxRows.length],["Team PTS",totals.pts],["Rebounds",(totals.oreb||0)+(totals.dreb||0)],["Assists",totals.ast]].map(([l,v])=>(
                  <div key={l}><div style={{fontFamily:"'Bebas Neue',cursive",fontSize:24,color:T.red,lineHeight:1}}>{v}</div><div style={{fontSize:10,color:T.textDim,textTransform:"uppercase"}}>{l}</div></div>
                ))}
              </div>
            </div>
          </div>
          {delConfirm&&<div style={{background:"rgba(239,68,68,0.1)",border:"1px solid #ef444466",borderRadius:12,padding:"12px 16px",marginBottom:14}}>
            <div style={{fontSize:13,color:"#ef4444",fontWeight:600,marginBottom:10}}>⚠️ Delete this game and all {boxRows.length} player logs?</div>
            <div style={{display:"flex",gap:8}}>
              <button className="btn-ghost" style={{flex:1,fontSize:13}} onClick={()=>setDelConfirm(false)}>Cancel</button>
              <button style={{flex:1,background:"#ef4444",color:T.text,fontWeight:700,border:"none",borderRadius:10,padding:"9px",cursor:"pointer",fontSize:13}} onClick={()=>deleteGame(selGame.id)}>Yes, Delete</button>
            </div>
          </div>}
          {boxRows.length===0 ? <Empty icon="📋" title="NO STATS LOGGED" sub="Go to Players tab and tap '+ Log' to add stats for this game"/>
            : <>
                <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:14,overflow:"hidden",marginBottom:12}}>
                  <div style={{overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",minWidth:520}}>
                      <thead>
                        <tr style={{background:"#0a0a0a"}}>
                          <th style={{padding:"9px 12px",textAlign:"left",fontSize:10,color:T.textDim,fontWeight:700,textTransform:"uppercase",position:"sticky",left:0,background:"#0a0a0a",minWidth:130,whiteSpace:"nowrap"}}>Player</th>
                          {BOX_COLS.map(k=><th key={k} style={{padding:"9px 7px",textAlign:"center",fontSize:10,color:T.textDim,fontWeight:700,textTransform:"uppercase",whiteSpace:"nowrap"}}>{STAT_FIELDS.find(f=>f.key===k)?.label||k}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {boxRows.map(row=>{
                          const pIdx=players.findIndex(p=>p.id===row.playerId);
                          const color=J_COLORS[pIdx%J_COLORS.length]||T.red;
                          return (
                            <tr key={row.id} style={{borderTop:`1px solid ${T.border}`}}>
                              <td style={{padding:"9px 12px",position:"sticky",left:0,background:T.bgCard,borderRight:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>
                                <div style={{display:"flex",alignItems:"center",gap:8}}>
                                  <div style={{width:24,height:24,background:color,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue',cursive",fontSize:11,color:"#000",flexShrink:0}}>{row.playerNumber}</div>
                                  <span style={{fontWeight:600,fontSize:12}}>{row.playerName}</span>
                                </div>
                              </td>
                              {BOX_COLS.map(k=><td key={k} style={{padding:"9px 7px",textAlign:"center",fontSize:13,color:k==="pts"&&(row[k]||0)>20?T.red:k==="pts"&&(row[k]||0)>0?"#ddd":T.textDim,fontWeight:k==="pts"?600:400}}>{row[k]||0}</td>)}
                            </tr>
                          );
                        })}
                        <tr style={{borderTop:`2px solid #2a2a2a`,background:"#0a0a0a"}}>
                          <td style={{padding:"10px 12px",position:"sticky",left:0,background:"#0a0a0a",borderRight:`1px solid ${T.border}`}}><div style={{fontSize:10,fontWeight:700,color:T.red,textTransform:"uppercase",letterSpacing:1}}>TEAM</div></td>
                          {BOX_COLS.map(k=><td key={k} style={{padding:"10px 7px",textAlign:"center",fontSize:13,fontWeight:700,color:k==="pts"?T.red:"#888"}}>{totals[k]||0}</td>)}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                  {[{label:"Top Scorer",key:"pts",suf:"PTS",fn:r=>(r.pts||0)},{label:"Top Rebounder",key:"reb",suf:"REB",fn:r=>(r.oreb||0)+(r.dreb||0)},{label:"Top Passer",key:"ast",suf:"AST",fn:r=>(r.ast||0)}].map(({label,key,suf,fn})=>{
                    const best=[...boxRows].sort((a,b)=>fn(b)-fn(a))[0];
                    return (
                      <div key={key} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 10px",textAlign:"center"}}>
                        <div style={{fontSize:9,color:T.textDim,textTransform:"uppercase",letterSpacing:0.8,marginBottom:4}}>{label}</div>
                        <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:24,color:T.red,lineHeight:1}}>{best?fn(best):0}</div>
                        <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",marginBottom:4}}>{suf}</div>
                        <div style={{fontWeight:600,fontSize:11,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{best?.playerName?.split(" ")[0]||"—"}</div>
                      </div>
                    );
                  })}
                </div>
              </>
          }
        </div>
      </div>
    );
  }
  return null;
}

// ─── MODULE: ROSTER ───────────────────────────────────────────────────────────
function Roster({ players, games, logs, savePlayers, saveLogs }) {
  const [view,setView]         = useState("list");
  const [sel,setSel]           = useState(null);
  const [newName,setNewName]   = useState("");
  const [newNum,setNewNum]     = useState("");
  const [selGame,setSelGame]   = useState("");
  const [logStats,setLogStats] = useState(emptyStats());
  const [saving,setSaving]     = useState(false);
  const [dtab,setDtab]         = useState("avgs");

  const goDetail = p => { setSel(p); setView("detail"); setDtab("avgs"); };
  const goBack   = () => setView(view==="detail"?"list":view==="addPlayer"?"list":"detail");

  const addPlayer = async () => {
    if(!newName.trim()) return; setSaving(true);
    await savePlayers([...players,{id:newId("p"),name:newName.trim(),number:newNum.trim()}]);
    setNewName(""); setNewNum(""); setSaving(false); setView("list");
  };
  const deletePlayer = async id => {
    if(!window.confirm("Delete player and all their stats?")) return;
    await savePlayers(players.filter(p=>p.id!==id));
    await saveLogs(logs.filter(l=>l.playerId!==id));
    setView("list");
  };
  const openAddLog = p => {
    setSel(p); setView("addLog"); setLogStats(emptyStats());
    const sorted=[...games].sort((a,b)=>b.date.localeCompare(a.date));
    setSelGame(sorted.length?sorted[0].id:"");
  };
  const saveLog = async () => {
    if(!sel||!selGame) return; setSaving(true);
    const nl={id:newId("gl"),playerId:sel.id,gameId:selGame,...Object.fromEntries(STAT_FIELDS.map(f=>[f.key,Number(logStats[f.key])||0]))};
    const ex=logs.find(l=>l.playerId===sel.id&&l.gameId===selGame);
    await saveLogs(ex?logs.map(l=>l.id===ex.id?{...nl,id:l.id}:l):[...logs,nl]);
    setSaving(false); setView("detail");
  };

  const stat=sel?getPlayerStats(sel.id,logs):null;
  const hdrRight=view==="list"
    ? <button className="btn-primary" style={{padding:"7px 14px",fontSize:13}} onClick={()=>setView("addPlayer")}>+ Add</button>
    : view==="detail"
    ? <div style={{display:"flex",gap:6}}>
        <button className="btn-primary" style={{padding:"7px 12px",fontSize:13}} onClick={()=>openAddLog(sel)}>+ Log</button>
        <button className="btn-ghost" style={{padding:"7px 10px",fontSize:13}} onClick={()=>deletePlayer(sel.id)}>🗑</button>
      </div>
    : null;

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <SubHeader title={view==="list"?"👥 PLAYERS":view==="detail"?sel?.name?.toUpperCase():view==="addPlayer"?"NEW PLAYER":"LOG GAME"}
        showBack={view!=="list"} onBack={goBack} right={hdrRight}/>
      <div className="module-scroll">
        {view==="list"&&(players.length===0 ? <Empty icon="👤" title="NO PLAYERS YET" sub="Add players or scan a scoresheet"/>
          : players.map((p,i)=>{ const s=getPlayerStats(p.id,logs); return (
              <div key={p.id} className="list-row" onClick={()=>goDetail(p)}>
                <div className="jersey-badge" style={{background:J_COLORS[i%J_COLORS.length],marginLeft:14}}>{p.number||"?"}</div>
                <div style={{flex:1}}><div style={{fontWeight:700,fontSize:15}}>{p.name}</div><div style={{fontSize:12,color:T.textMuted,marginTop:1}}>{s?`${s.gp} GP · ${s.avgs.pts.toFixed(1)} PPG · ${s.avgs.ast.toFixed(1)} APG · ${(s.avgs.oreb+s.avgs.dreb).toFixed(1)} RPG`:"No games logged"}</div></div>
                <div style={{color:T.border,fontSize:20,marginRight:14}}>›</div>
              </div>
            );})
        )}

        {view==="addPlayer"&&<Card>
          <SectionLbl>Player Info</SectionLbl>
          <Field label="Full Name *"><input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="e.g. Marcus Johnson" className="text-input"/></Field>
          <div style={{height:10}}/>
          <Field label="Jersey Number"><input value={newNum} onChange={e=>setNewNum(e.target.value)} placeholder="23" className="text-input" style={{width:80}}/></Field>
          <button className="btn-primary btn-full" style={{marginTop:20}} onClick={addPlayer} disabled={!newName.trim()||saving}>{saving?"SAVING...":"SAVE PLAYER"}</button>
        </Card>}

        {view==="detail"&&sel&&<>
          <div style={{background:`linear-gradient(135deg,#130005,${T.bg})`,border:`1px solid ${T.redBorder}`,borderRadius:18,padding:18,marginBottom:14,display:"flex",alignItems:"center",gap:14}}>
            <div style={{width:60,height:60,background:T.red,borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue',cursive",fontSize:26,color:T.text}}>{sel.number||"?"}</div>
            <div><div style={{fontFamily:"'Bebas Neue',cursive",fontSize:24,letterSpacing:1}}>{sel.name}</div><div style={{color:T.textMuted,fontSize:13}}>{stat?`${stat.gp} games played`:"No stats yet"}</div></div>
          </div>
          {stat?<>
            <div style={{display:"flex",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:12,padding:3,marginBottom:14,gap:3}}>
              {[["avgs","Per Game"],["totals","Totals"],["log","Game Log"]].map(([t,l])=>(
                <button key={t} onClick={()=>setDtab(t)} style={{flex:1,background:dtab===t?T.red:"transparent",color:dtab===t?T.text:T.textMuted,border:"none",borderRadius:9,padding:"8px",fontSize:13,fontWeight:600,cursor:"pointer",transition:"all 0.2s"}}>{l}</button>
              ))}
            </div>
            {(dtab==="avgs"||dtab==="totals")&&<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
              {[{key:"pts",l:"Points"},{key:"dreb",l:"Def Reb"},{key:"oreb",l:"Off Reb"},{key:"ast",l:"Assists"},{key:"stl",l:"Steals"},{key:"blk",l:"Blocks"},{key:"tov",l:"Turnovers"},{key:"pf",l:"Fouls"},{key:"fgm",l:"FGM"},{key:"fga",l:"FGA"},{key:"tpm",l:"3PM"},{key:"fta",l:"FTA"}].map(({key,l})=>{
                const val=dtab==="avgs"?stat.avgs[key].toFixed(1):stat.totals[key];
                return <div key={key} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:12,padding:"12px 10px"}}><div style={{fontSize:10,color:T.textDim,marginBottom:3,textTransform:"uppercase"}}>{l}</div><div style={{fontFamily:"'Bebas Neue',cursive",fontSize:26,color:T.red}}>{val}</div></div>;
              })}
            </div>}
            {dtab==="log"&&stat.logs.map(l=>{ const g=games.find(g=>g.id===l.gameId); return (
              <Card key={l.id} style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                  <div><div style={{fontWeight:600,fontSize:14}}>{g?.opponent||"Unknown"}</div><div style={{fontSize:11,color:T.textMuted}}>{g?.date||"—"}{g?.result&&` · ${g.result}`}</div></div>
                  <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:34,color:T.red,lineHeight:1}}>{l.pts}</div>
                </div>
                <div style={{display:"flex",flexWrap:"wrap",gap:10}}>{[["REB",(l.oreb||0)+(l.dreb||0)],["AST",l.ast],["STL",l.stl],["BLK",l.blk],["TOV",l.tov],["PF",l.pf]].map(([lb,v])=><span key={lb} style={{fontSize:12,color:T.textMuted}}><span style={{color:T.textDim}}>{lb} </span>{v}</span>)}</div>
              </Card>
            );})}
          </>:<Empty icon="📊" title="NO STATS YET" sub='Tap "+ Log" above to add game stats'/>}
        </>}

        {view==="addLog"&&sel&&<Card>
          <SectionLbl>Select Game</SectionLbl>
          {games.length===0 ? <div style={{color:T.textMuted,fontSize:14,marginBottom:16}}>No games yet. Create one in the Games tab first.</div>
            : <select value={selGame} onChange={e=>setSelGame(e.target.value)} style={{width:"100%",background:T.bgInput,border:`1px solid ${T.border2}`,borderRadius:8,color:T.text,padding:"10px 12px",fontSize:14,marginBottom:16}}>
                {[...games].sort((a,b)=>b.date.localeCompare(a.date)).map(g=><option key={g.id} value={g.id}>{g.date} vs {g.opponent||"Unknown"}{g.result&&` (${g.result})`}</option>)}
              </select>}
          <SectionLbl>Stats</SectionLbl>
          <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
            {STAT_FIELDS.map(f=>(
              <div key={f.key} style={{textAlign:"center"}}>
                <div style={{fontSize:9,color:T.textDim,marginBottom:3,fontWeight:700,textTransform:"uppercase"}}>{f.label}</div>
                <input type="number" min="0" value={logStats[f.key]} onChange={e=>setLogStats(s=>({...s,[f.key]:e.target.value}))} style={{width:44,background:T.bgInput,border:`1px solid ${T.border2}`,borderRadius:7,color:T.text,padding:"5px 3px",textAlign:"center",fontSize:13}}/>
              </div>
            ))}
          </div>
          <button className="btn-primary btn-full" onClick={saveLog} disabled={!selGame||saving}>{saving?"SAVING...":"SAVE GAME LOG"}</button>
        </Card>}
      </div>
    </div>
  );
}

// ─── MODULE: ANALYTICS ───────────────────────────────────────────────────────
const METRICS=[
  {key:"ts", label:"True Shooting %",  fmt:v=>`${(v*100).toFixed(1)}%`, good:0.52,great:0.60, desc:"Points per shooting opportunity, accounting for 3-pointers and free throws."},
  {key:"efg",label:"Eff. Field Goal %",fmt:v=>`${(v*100).toFixed(1)}%`, good:0.48,great:0.56, desc:"Like FG% but gives 50% bonus credit for every 3-pointer made."},
  {key:"per",label:"PER (simplified)", fmt:v=>v.toFixed(1),             good:12,  great:18,   desc:"Player Efficiency Rating. Combines all box score stats. League average ≈ 15."},
  {key:"ato",label:"Assist / Turnover",fmt:v=>v>=999?"∞":v.toFixed(2), good:1.5, great:2.5,  desc:"Assists divided by turnovers. Higher is more efficient playmaking."},
];
function MBar({value,good,great}) {
  const c=value>=great?T.green:value>=good?T.red:T.textDim;
  return <div style={{height:5,background:"#1e1e1e",borderRadius:3,marginTop:7,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min(100,(value/(great*1.8))*100)}%`,background:c,borderRadius:3,transition:"width 0.8s ease"}}/></div>;
}

function Analytics({ players, logs }) {
  const [sel,setSel]   = useState(null);
  const [exp,setExp]   = useState(null);
  useEffect(()=>{ if(players.length&&!sel) setSel(players[0]); },[players]);
  const stat=sel?getPlayerStats(sel.id,logs):null;

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <SubHeader title="📊 ANALYTICS" sub="Basketball Reference formulas"/>
      <div className="module-scroll">
        {!players.length ? <Empty icon="📈" title="NO DATA YET" sub="Scan a scoresheet or log stats first"/> : <>
          <div style={{display:"flex",gap:7,overflowX:"auto",paddingBottom:6,marginBottom:18}}>
            {players.map(p=>{ const s=getPlayerStats(p.id,logs); return (
              <button key={p.id} onClick={()=>{setSel(p);setExp(null);}}
                style={{flexShrink:0,background:sel?.id===p.id?T.red:T.bgCard,color:sel?.id===p.id?T.text:T.textMuted,border:`1px solid ${sel?.id===p.id?T.red:T.border}`,borderRadius:10,padding:"7px 13px",cursor:"pointer",fontSize:13,fontWeight:600,whiteSpace:"nowrap",transition:"all 0.2s"}}>
                {p.name.split(" ")[0]}{s&&<span style={{opacity:0.7,fontSize:11,marginLeft:3}}>({s.gp}G)</span>}
              </button>
            );})}
          </div>
          {stat&&sel?<>
            <div style={{background:`linear-gradient(135deg,#130005,${T.bg})`,border:`1px solid ${T.redBorder}`,borderRadius:18,padding:18,marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
                <div><div style={{fontFamily:"'Bebas Neue',cursive",fontSize:22,letterSpacing:1}}>{sel.name}</div><div style={{color:T.textMuted,fontSize:12}}>{stat.gp} games</div></div>
                <div style={{textAlign:"right"}}><div style={{fontFamily:"'Bebas Neue',cursive",fontSize:40,color:T.red,lineHeight:1}}>{stat.per.toFixed(1)}</div><div style={{fontSize:10,color:T.textDim,textTransform:"uppercase",letterSpacing:1}}>PER</div></div>
              </div>
              <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                {[["PPG",(stat.totals.pts/stat.gp).toFixed(1)],["RPG",((stat.totals.oreb+stat.totals.dreb)/stat.gp).toFixed(1)],["APG",(stat.totals.ast/stat.gp).toFixed(1)],["SPG",(stat.totals.stl/stat.gp).toFixed(1)]].map(([l,v])=>(
                  <div key={l} style={{background:T.bgInput,borderRadius:8,padding:"6px 11px",textAlign:"center"}}><div style={{fontSize:16,fontWeight:700}}>{v}</div><div style={{fontSize:9,color:T.textDim,textTransform:"uppercase"}}>{l}</div></div>
                ))}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
              {METRICS.map(m=>{ const val=m.key==="ts"?stat.ts:m.key==="efg"?stat.efg:m.key==="per"?stat.per:stat.ato; const isEx=exp===m.key; const tier=val>=m.great?"ELITE":val>=m.good?"SOLID":"—"; const tc=val>=m.great?T.green:val>=m.good?T.red:T.textDim; return (
                <div key={m.key} onClick={()=>setExp(isEx?null:m.key)} style={{background:T.bgCard,border:`1px solid ${isEx?T.red:T.border}`,borderRadius:14,padding:14,cursor:"pointer",transition:"all 0.2s",gridColumn:isEx?"span 2":"span 1"}}>
                  <div style={{display:"flex",justifyContent:"space-between"}}><div style={{fontSize:10,color:T.textDim,textTransform:"uppercase",letterSpacing:0.8,lineHeight:1.4}}>{m.label}</div><span style={{background:`${tc}22`,color:tc,borderRadius:5,padding:"1px 7px",fontSize:10,fontWeight:700}}>{tier}</span></div>
                  <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:34,color:T.red,lineHeight:1,margin:"6px 0 2px"}}>{m.fmt(val>=999?999:val)}</div>
                  <MBar value={val>=999?m.great*2:val} good={m.good} great={m.great}/>
                  {isEx&&<div style={{marginTop:10,fontSize:12,color:"#888",lineHeight:1.6,borderTop:`1px solid ${T.border}`,paddingTop:10}}>{m.desc}<div style={{display:"flex",gap:12,marginTop:6}}><span style={{color:T.red}}>● Solid: {m.fmt(m.good)}</span><span style={{color:T.green}}>● Elite: {m.fmt(m.great)}</span></div></div>}
                </div>
              );})}
            </div>
            <Card>
              <SectionLbl>Shooting Splits</SectionLbl>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:12}}>
                {[["FG%",stat.fgpct,0.40,0.50],["3P%",stat.tppct,0.30,0.38],["FT%",stat.ftpct,0.65,0.80]].map(([l,v,g,gr])=>(
                  <div key={l} style={{textAlign:"center"}}><div style={{fontFamily:"'Bebas Neue',cursive",fontSize:26,color:v>=gr?T.green:v>=g?T.red:T.textDim}}>{(v*100).toFixed(1)}%</div><div style={{fontSize:10,color:T.textDim,textTransform:"uppercase",marginTop:2}}>{l}</div><MBar value={v} good={g} great={gr}/></div>
                ))}
              </div>
              <div style={{background:T.bgInput,borderRadius:9,padding:"9px 12px",display:"flex",gap:14,flexWrap:"wrap"}}>
                {[["FG",`${stat.totals.fgm}/${stat.totals.fga}`],["3P",`${stat.totals.tpm}/${stat.totals.tpa}`],["FT",`${stat.totals.ftm}/${stat.totals.fta}`]].map(([l,v])=><span key={l} style={{fontSize:13}}><span style={{color:T.textDim}}>{l}: </span><span style={{fontWeight:600}}>{v}</span></span>)}
              </div>
            </Card>
          </>:<Empty icon="📊" title="NO STATS" sub={`No games logged for ${sel?.name||"this player"} yet`}/>}
        </>}
      </div>
    </div>
  );
}

// ─── MODULE: LEADERBOARD ─────────────────────────────────────────────────────
const LB_COLS=[
  {key:"gp",  label:"GP",  fmt:v=>v},
  {key:"ppg", label:"PPG", fmt:v=>v.toFixed(1)},
  {key:"rpg", label:"RPG", fmt:v=>v.toFixed(1)},
  {key:"apg", label:"APG", fmt:v=>v.toFixed(1)},
  {key:"spg", label:"SPG", fmt:v=>v.toFixed(1)},
  {key:"bpg", label:"BPG", fmt:v=>v.toFixed(1)},
  {key:"topg",label:"TOV", fmt:v=>v.toFixed(1)},
  {key:"ts",  label:"TS%", fmt:v=>`${(v*100).toFixed(1)}%`,adv:true},
  {key:"efg", label:"eFG%",fmt:v=>`${(v*100).toFixed(1)}%`,adv:true},
  {key:"per", label:"PER", fmt:v=>v.toFixed(1),            adv:true},
  {key:"ato", label:"A/TO",fmt:v=>v>=999?"∞":v.toFixed(2),adv:true},
  {key:"fgpct",label:"FG%",fmt:v=>`${(v*100).toFixed(1)}%`,adv:true},
];

function Leaderboard({ players, logs }) {
  const [sortKey,setSortKey]=useState("ppg");
  const [sortDir,setSortDir]=useState(-1);
  const [adv,setAdv]=useState(false);
  const [minGP,setMinGP]=useState(1);

  const rows=players.map((p,i)=>{ const s=getPlayerStats(p.id,logs); if(!s) return null;
    const t=s.totals,gp=s.gp;
    const ppg=t.pts/gp,rpg=(t.oreb+t.dreb)/gp,apg=t.ast/gp,spg=t.stl/gp,bpg=t.blk/gp,topg=t.tov/gp;
    const anomalies=[]; if(ppg>ANOMALY.pts) anomalies.push(`${ppg.toFixed(1)} PPG`); if(apg>ANOMALY.ast) anomalies.push(`${apg.toFixed(1)} APG`);
    return {player:p,ci:i,gp,ppg,rpg,apg,spg,bpg,topg,ts:s.ts,efg:s.efg,per:s.per,ato:s.ato,fgpct:s.fgpct,anomalies};
  }).filter(r=>r&&r.gp>=minGP).sort((a,b)=>sortDir*(b[sortKey]-a[sortKey]));

  const hs=k=>{ if(sortKey===k) setSortDir(d=>-d); else{setSortKey(k);setSortDir(-1);}};
  const cols=LB_COLS.filter(c=>!adv?!c.adv:c.adv);
  const awards=[
    {icon:"🏀",l:"Scorer", p:rows.reduce((b,r)=>(!b||r.ppg>b.ppg)?r:b,null),s:r=>`${r.ppg.toFixed(1)} PPG`},
    {icon:"⚡",l:"PER",    p:rows.reduce((b,r)=>(!b||r.per>b.per)?r:b,null),s:r=>`${r.per.toFixed(1)}`},
    {icon:"🎯",l:"Passer", p:rows.reduce((b,r)=>(!b||r.apg>b.apg)?r:b,null),s:r=>`${r.apg.toFixed(1)} APG`},
  ];

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      <SubHeader title="🏆 LEADERS" sub="Tap any column to sort"/>
      <div className="module-scroll">
        {!players.length?<Empty icon="🏆" title="NO STATS YET" sub="Scan a scoresheet or log games to populate the leaderboard"/>:<>
          {rows.length>=2&&<div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:16}}>
            {awards.map(({icon,l,p,s})=>p&&<div key={l} style={{background:`linear-gradient(135deg,#130005,${T.bgCard})`,border:`1px solid ${T.redBorder}`,borderRadius:12,padding:"12px 10px",textAlign:"center"}}>
              <div style={{fontSize:18,marginBottom:3}}>{icon}</div>
              <div style={{fontSize:9,color:T.textMuted,textTransform:"uppercase",letterSpacing:0.8,marginBottom:3}}>{l}</div>
              <div style={{fontWeight:700,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.player.name.split(" ")[0]}</div>
              <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:20,color:T.red,lineHeight:1.2}}>{s(p)}</div>
            </div>)}
          </div>}
          {rows.some(r=>r.anomalies.length>0)&&<div style={{background:"rgba(239,68,68,0.07)",border:"1px solid #ef444433",borderRadius:12,padding:"10px 14px",marginBottom:14}}>
            <div style={{fontSize:11,color:"#ef4444",fontWeight:700,marginBottom:6,textTransform:"uppercase",letterSpacing:1}}>⚠ Data Quality Flags</div>
            {rows.filter(r=>r.anomalies.length>0).map(r=><div key={r.player.id} style={{fontSize:12,color:"#ef4444",marginBottom:2}}><span style={{color:T.red,fontWeight:600}}>{r.player.name}: </span>{r.anomalies.join(", ")} — verify stats</div>)}
          </div>}
          <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{display:"flex",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:10,padding:3,gap:3}}>
              {[["Basic",false],["Advanced",true]].map(([l,v])=><button key={l} onClick={()=>{setAdv(v);setSortKey(v?"per":"ppg");setSortDir(-1);}} style={{background:adv===v?T.red:"transparent",color:adv===v?T.text:T.textMuted,border:"none",borderRadius:7,padding:"6px 12px",fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.2s"}}>{l}</button>)}
            </div>
            <select value={minGP} onChange={e=>setMinGP(Number(e.target.value))} style={{marginLeft:"auto",background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"6px 10px",fontSize:12}}>
              {[1,2,3,5].map(n=><option key={n} value={n}>Min {n} GP</option>)}
            </select>
          </div>
          <div style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:14,overflow:"hidden"}}>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:320}}>
                <thead>
                  <tr style={{background:"#0a0a0a"}}>
                    <th style={{padding:"9px 12px",textAlign:"left",fontSize:10,color:T.textDim,fontWeight:700,textTransform:"uppercase",letterSpacing:1,position:"sticky",left:0,background:"#0a0a0a",minWidth:130,whiteSpace:"nowrap"}}>Player</th>
                    {cols.map(c=><th key={c.key} onClick={()=>hs(c.key)} style={{padding:"9px 8px",textAlign:"center",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,cursor:"pointer",userSelect:"none",color:sortKey===c.key?T.red:T.textDim,whiteSpace:"nowrap",transition:"color 0.2s"}}>{c.label}{sortKey===c.key?(sortDir===-1?" ↓":" ↑"):""}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r,rank)=>(
                    <tr key={r.player.id} style={{borderTop:`1px solid ${T.border}`}}>
                      <td style={{padding:"9px 12px",position:"sticky",left:0,background:T.bgCard,borderRight:`1px solid ${T.border}`,whiteSpace:"nowrap"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{width:26,height:26,background:J_COLORS[r.ci%J_COLORS.length],borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Bebas Neue',cursive",fontSize:12,color:"#000",flexShrink:0}}>{r.player.number||"?"}</div>
                          <div><div style={{fontWeight:600,fontSize:12}}>{r.player.name}</div><div style={{fontSize:9,color:T.textDim}}>{r.gp} GP</div></div>
                          {rank===0&&"🥇"}{rank===1&&"🥈"}{rank===2&&"🥉"}
                          {r.anomalies.length>0&&<span title={r.anomalies.join("; ")}>⚠️</span>}
                        </div>
                      </td>
                      {cols.map(c=><td key={c.key} style={{padding:"9px 8px",textAlign:"center",fontSize:13,fontWeight:sortKey===c.key?700:400,color:sortKey===c.key?T.red:"#ccc"}}>{c.fmt(r[c.key])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{textAlign:"center",marginTop:12,fontSize:11,color:T.textDim}}>{rows.length} player{rows.length!==1?"s":""} shown</div>
        </>}
      </div>
    </div>
  );
}

// ─── NAV + ROOT ───────────────────────────────────────────────────────────────
const NAV=[
  {id:"scanner",    icon:"📸",label:"Scan"},
  {id:"roster",     icon:"👥",label:"Players"},
  {id:"games",      icon:"🗓",label:"Games"},
  {id:"analytics",  icon:"📊",label:"Stats"},
  {id:"leaderboard",icon:"🏆",label:"Ranks"},
];

export default function App() {
  const [tab,setTab] = useState("scanner");
  const data = useAppData();

  if(!data.ready) return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
      <div className="buckets-spinner"/>
      <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:14,color:"#2a0a12",marginTop:16,letterSpacing:3}}>CONNECTING...</div>
    </div>
  );

  return (
    <div style={{height:"100dvh",display:"flex",flexDirection:"column",background:T.bg,color:T.text,overflow:"hidden"}}>
      {/* Global header */}
      <div style={{background:T.bg,borderBottom:`1px solid ${T.border}`,padding:"10px 18px",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <img src="/icon-192.png" alt="Getting Buckets" width="34" height="34" style={{borderRadius:8,display:"block"}}/>
          <div>
            <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:22,color:T.red,letterSpacing:3,lineHeight:1}}>GETTING BUCKETS</div>
            <div style={{fontSize:9,color:"#6b2a3a",letterSpacing:2,textTransform:"uppercase",marginTop:1}}>40+ League Tracker</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <SyncDot status={data.syncStatus}/>
          <div style={{display:"flex",gap:5}}>
            {[["P",data.players.length,"Players"],["G",data.games.length,"Games"]].map(([l,v,tt])=>(
              <div key={l} style={{background:T.bgCard,border:`1px solid ${T.border}`,borderRadius:7,padding:"3px 9px",textAlign:"center"}} title={tt}>
                <div style={{fontFamily:"'Bebas Neue',cursive",fontSize:17,color:T.red,lineHeight:1}}>{v}</div>
                <div style={{fontSize:9,color:T.textDim,textTransform:"uppercase"}}>{tt}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {data.dbError&&<div className="alert-red" style={{margin:"8px 12px 0",flexShrink:0}}>⚠ {data.dbError} <button onClick={()=>data.setDbError(null)} style={{float:"right",background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:16}}>×</button></div>}

      {/* Tab panels */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {tab==="scanner"    &&<div style={{display:"flex",flexDirection:"column",height:"100%"}}><SubHeader title="📸 SCANNER" sub="Photo → Stats in seconds"/><Scanner {...data} onDone={t=>setTab(t||"games")}/></div>}
        {tab==="roster"     &&<Roster       {...data}/>}
        {tab==="games"      &&<GamesManager {...data} onNavigate={setTab}/>}
        {tab==="analytics"  &&<Analytics     players={data.players} logs={data.logs}/>}
        {tab==="leaderboard"&&<Leaderboard   players={data.players} logs={data.logs}/>}
      </div>

      {/* Bottom nav */}
      <div style={{background:"#050505",borderTop:`1px solid ${T.border}`,display:"grid",gridTemplateColumns:"repeat(5,1fr)",flexShrink:0,paddingBottom:"env(safe-area-inset-bottom,0px)"}}>
        {NAV.map(n=>(
          <button key={n.id} onClick={()=>setTab(n.id)}
            style={{background:"none",border:"none",padding:"11px 2px 9px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:2,transition:"all 0.15s",position:"relative"}}>
            <div style={{fontSize:tab===n.id?22:19,transition:"transform 0.2s",transform:tab===n.id?"scale(1.15)":"scale(1)"}}>{n.icon}</div>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:0.3,color:tab===n.id?T.red:T.textDim,transition:"color 0.15s",textTransform:"uppercase"}}>{n.label}</div>
            {tab===n.id&&<div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",width:20,height:2,background:T.red,borderRadius:"0 0 3px 3px"}}/>}
          </button>
        ))}
      </div>
    </div>
  );
}
