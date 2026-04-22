// app/(app)/board/[id]/page.tsx
// STANDOUT FEATURES:
//  1. Presentation mode — spotlight any shape, auto-pan through all shapes
//  2. Reaction stamps — floating emoji anyone can stamp on the canvas
//  3. Smart snap guides — pink alignment lines when dragging
//  4. Board Chat — floating chat panel, messages tied to the board
//  5. Shape Templates — one-click pre-built diagram starters
//  6. Board Analytics — who drew what, shape counts per collaborator
//  7. AI Smart Describe — select shapes and ask AI to explain the diagram
"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { connectSocket, disconnectSocket } from "@/lib/socket"
import { boardAPI } from "@/lib/api"
import { useAuthGuard } from "@/lib/useAuth"

const KonvaBoard = dynamic(() => import("./KonvaBoard"), {
  ssr: false,
  loading: () => (
    <div style={{ flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#58587a",fontFamily:"monospace",fontSize:13 }}>
      Loading canvas...
    </div>
  ),
})

export type ShapeType = "rect"|"ellipse"|"diamond"|"text"|"pen"|"arrow"|"triangle"|"cylinder"|"parallelogram"
export interface Shape {
  id:string;type:ShapeType;x:number;y:number;width:number;height:number
  fill:string;stroke:string;strokeWidth:number
  label?:string;fontSize?:number;fontStyle?:string;textColor?:string
  points?:number[];opacity:number;rotation:number
  createdBy?:string;createdAt?:number
}
export interface Cursor { socketId:string;userId:string;name:string;color:string;x:number;y:number }
export type Tool = "select"|"rect"|"ellipse"|"diamond"|"triangle"|"cylinder"|"parallelogram"|"text"|"pen"|"arrow"

interface ChatMessage { id:string;userId:string;name:string;color:string;text:string;ts:number }
interface Reaction    { id:string;x:number;y:number;emoji:string;born:number }

const TOOLS: { id:Tool;icon:string;label:string }[] = [
  {id:"select",icon:"↖",label:"Select V"},{id:"rect",icon:"▭",label:"Rect R"},
  {id:"ellipse",icon:"○",label:"Ellipse E"},{id:"diamond",icon:"◇",label:"Diamond D"},
  {id:"triangle",icon:"△",label:"Triangle G"},{id:"cylinder",icon:"⬭",label:"Cylinder Y"},
  {id:"parallelogram",icon:"▱",label:"Parallelogram"},{id:"text",icon:"T",label:"Text T"},
  {id:"pen",icon:"✏",label:"Pen P"},{id:"arrow",icon:"→",label:"Arrow A"},
]
// Colors visible on BOTH light and dark backgrounds
const PALETTE = ["#4f46e5","#059669","#dc2626","#d97706","#2563eb","#9333ea","#ea580c","#374151","#0f172a","#be185d"]
// Light fills for shapes (visible on white canvas in light mode)
const FILL_PALETTE = ["transparent","#ede9fe","#d1fae5","#fee2e2","#fef3c7","#dbeafe","#f3e8ff","#ffedd5","#f1f5f9","#1e293b","#fce7f3"]
const REACTIONS = ["👍","❤️","🔥","💡","⚠️","✅","❓","🎉","😮","👀"]

// ── Diagram templates ──
const TEMPLATES = {
  "Basic flowchart": [
    {id:"t1",type:"ellipse" as ShapeType,x:80,y:60,width:140,height:50,fill:"#0a2520",stroke:"#22d3a0",strokeWidth:2,label:"Start",fontSize:13,opacity:1,rotation:0},
    {id:"t2",type:"rect"    as ShapeType,x:80,y:180,width:160,height:55,fill:"#1a1535",stroke:"#6c63ff",strokeWidth:2,label:"Process",fontSize:13,opacity:1,rotation:0},
    {id:"t3",type:"diamond" as ShapeType,x:80,y:305,width:160,height:70,fill:"#0a1a30",stroke:"#3b82f6",strokeWidth:2,label:"Decision?",fontSize:13,opacity:1,rotation:0},
    {id:"t4",type:"ellipse" as ShapeType,x:80,y:445,width:140,height:50,fill:"#2a0f0f",stroke:"#f87171",strokeWidth:2,label:"End",fontSize:13,opacity:1,rotation:0},
    {id:"t5",type:"arrow"   as ShapeType,x:150,y:110,width:0,height:0,fill:"#22d3a0",stroke:"#22d3a0",strokeWidth:1.5,label:"",fontSize:12,opacity:1,rotation:0,points:[150,110,150,180]},
    {id:"t6",type:"arrow"   as ShapeType,x:160,y:235,width:0,height:0,fill:"#6c63ff",stroke:"#6c63ff",strokeWidth:1.5,label:"",fontSize:12,opacity:1,rotation:0,points:[160,235,160,305]},
    {id:"t7",type:"arrow"   as ShapeType,x:160,y:375,width:0,height:0,fill:"#22d3a0",stroke:"#22d3a0",strokeWidth:1.5,label:"Yes",fontSize:12,opacity:1,rotation:0,points:[160,375,160,445]},
  ],
  "ERD starter": [
    {id:"e1",type:"rect" as ShapeType,x:60,y:60,width:160,height:60,fill:"#1a1535",stroke:"#6c63ff",strokeWidth:2,label:"User",fontSize:13,opacity:1,rotation:0},
    {id:"e2",type:"rect" as ShapeType,x:280,y:60,width:160,height:60,fill:"#0a2520",stroke:"#22d3a0",strokeWidth:2,label:"Post",fontSize:13,opacity:1,rotation:0},
    {id:"e3",type:"rect" as ShapeType,x:500,y:60,width:160,height:60,fill:"#2a0f0f",stroke:"#f87171",strokeWidth:2,label:"Comment",fontSize:13,opacity:1,rotation:0},
    {id:"e4",type:"rect" as ShapeType,x:280,y:200,width:160,height:60,fill:"#0a1a30",stroke:"#3b82f6",strokeWidth:2,label:"Tag",fontSize:13,opacity:1,rotation:0},
    {id:"e5",type:"arrow" as ShapeType,x:220,y:90,width:0,height:0,fill:"#6c63ff",stroke:"#6c63ff",strokeWidth:1.5,label:"",fontSize:12,opacity:1,rotation:0,points:[220,90,280,90]},
    {id:"e6",type:"arrow" as ShapeType,x:440,y:90,width:0,height:0,fill:"#22d3a0",stroke:"#22d3a0",strokeWidth:1.5,label:"",fontSize:12,opacity:1,rotation:0,points:[440,90,500,90]},
    {id:"e7",type:"arrow" as ShapeType,x:360,y:120,width:0,height:0,fill:"#3b82f6",stroke:"#3b82f6",strokeWidth:1.5,label:"",fontSize:12,opacity:1,rotation:0,points:[360,120,360,200]},
  ],
  "System architecture": [
    {id:"s1",type:"rect" as ShapeType,x:220,y:40,width:160,height:55,fill:"#0a2520",stroke:"#22d3a0",strokeWidth:2,label:"Client",fontSize:13,opacity:1,rotation:0},
    {id:"s2",type:"rect" as ShapeType,x:220,y:180,width:160,height:55,fill:"#1a1535",stroke:"#6c63ff",strokeWidth:2,label:"API Gateway",fontSize:13,opacity:1,rotation:0},
    {id:"s3",type:"rect" as ShapeType,x:60,y:320,width:140,height:55,fill:"#1a1535",stroke:"#6c63ff",strokeWidth:2,label:"Auth Service",fontSize:12,opacity:1,rotation:0},
    {id:"s4",type:"rect" as ShapeType,x:230,y:320,width:160,height:55,fill:"#1a1535",stroke:"#6c63ff",strokeWidth:2,label:"Core Service",fontSize:12,opacity:1,rotation:0},
    {id:"s5",type:"cylinder" as ShapeType,x:220,y:460,width:160,height:70,fill:"#0a1a30",stroke:"#3b82f6",strokeWidth:2,label:"Database",fontSize:13,opacity:1,rotation:0},
    {id:"s6",type:"arrow" as ShapeType,x:300,y:95,width:0,height:0,fill:"#22d3a0",stroke:"#22d3a0",strokeWidth:1.5,label:"",fontSize:12,opacity:1,rotation:0,points:[300,95,300,180]},
    {id:"s7",type:"arrow" as ShapeType,x:300,y:235,width:0,height:0,fill:"#6c63ff",stroke:"#6c63ff",strokeWidth:1.5,label:"",fontSize:12,opacity:1,rotation:0,points:[300,235,130,320]},
    {id:"s8",type:"arrow" as ShapeType,x:300,y:235,width:0,height:0,fill:"#6c63ff",stroke:"#6c63ff",strokeWidth:1.5,label:"",fontSize:12,opacity:1,rotation:0,points:[300,235,310,320]},
    {id:"s9",type:"arrow" as ShapeType,x:310,y:375,width:0,height:0,fill:"#3b82f6",stroke:"#3b82f6",strokeWidth:1.5,label:"",fontSize:12,opacity:1,rotation:0,points:[310,375,310,460]},
  ],
}

function nanoId() { return `s${Date.now()}${Math.random().toString(36).slice(2,8)}` }

export default function BoardPage() {
  const { id: boardId } = useParams<{ id: string }>()
  const router  = useRouter()
  const { ready } = useAuthGuard()

  // Canvas state
  const [shapes, setShapes]           = useState<Shape[]>([])
  const [cursors, setCursors]         = useState<Cursor[]>([])
  const [tool, setTool]               = useState<Tool>("rect")
  const [strokeColor, setStrokeColor] = useState("#4f46e5")
  const [fillColor, setFillColor]     = useState("#ede9fe")
  const [strokeW, setStrokeW]         = useState(2.5)
  const [fontSize, setFontSize]       = useState(16)
  const [fontStyle, setFontStyle]     = useState<"normal"|"bold"|"italic">("normal")
  const [selected, setSelected]       = useState<string[]>([])

  // Board meta
  const [boardTitle, setBoardTitle]   = useState("")
  const [members, setMembers]         = useState<{ id:string;name:string;color:string }[]>([])
  const [myInfo, setMyInfo]           = useState<{id:string;name:string;color:string}|null>(null)
  const [connected, setConnected]     = useState(false)
  const [statusMsg, setStatusMsg]     = useState("")
  const [darkMode, setDarkMode]       = useState(false)
  const [mounted, setMounted]         = useState(false)

  // AI
  const [showAI, setShowAI]           = useState(false)
  const [aiPrompt, setAiPrompt]       = useState("")
  const [aiLoading, setAiLoading]     = useState(false)
  const [aiShapes, setAiShapes]       = useState<Shape[]|null>(null)
  const [aiDescribe, setAiDescribe]   = useState("")
  const [aiDescLoading, setAiDescLoading] = useState(false)

  // Presentation mode
  const [presentMode, setPresentMode] = useState(false)
  const [presentIdx, setPresentIdx]   = useState(0)
  const [presentList, setPresentList] = useState<string[]>([])

  // Reaction stamps
  const [reactions, setReactions]     = useState<Reaction[]>([])
  const [reactionPicker, setReactionPicker] = useState(false)
  const [activeReaction, setActiveReaction] = useState("👍")
  const [reactionMode, setReactionMode]     = useState(false)

  // Snap
  const [snapEnabled, setSnapEnabled] = useState(true)

  // Chat
  const [showChat, setShowChat]       = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput]     = useState("")
  const [unreadChat, setUnreadChat]   = useState(0)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Templates
  const [showTemplates, setShowTemplates] = useState(false)

  // Analytics
  const [showAnalytics, setShowAnalytics] = useState(false)

  // Version history
  const [showVersions, setShowVersions] = useState(false)
  const [snapshots, setSnapshots]       = useState<{index:number;label:string;savedAt:string}[]>([])

  // Share
  const [showShare, setShowShare]     = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviting, setInviting]       = useState(false)
  const [inviteMsg, setInviteMsg]     = useState("")
  const [shareLink, setShareLink]     = useState("")
  const [copiedLink, setCopiedLink]   = useState(false)

  const stageRef       = useRef<any>(null)
  const cursorThrottle = useRef<ReturnType<typeof setTimeout>|null>(null)
  const shapesRef      = useRef<Shape[]>([])
  shapesRef.current    = shapes

  useEffect(() => { setMounted(true) }, [])

  // ── Socket setup ──
  useEffect(() => {
    if (!ready || !boardId) return
    const socket = connectSocket()
    setConnected(socket.connected)

    const onConnect = () => {
      setConnected(true)
      setStatusMsg("Joining board...")
      socket.emit("board:join",{boardId})
    }
    socket.on("connect",    onConnect)
    socket.on("disconnect", ()=>{ setConnected(false); setStatusMsg("Reconnecting...") })

    socket.on("board:state", ({shapes:s,boardTitle:t}:any) => {
      if (t) setBoardTitle(t)
      setShapes(Array.isArray(s)?s:[])
      setStatusMsg("")   // clear "Joining..." message once loaded
    })

    socket.on("shape:upsert", ({shape}:any) => {
      if (!shape?.id) return
      setShapes(prev => {
        const idx=prev.findIndex(s=>s.id===shape.id)
        if (idx>=0) { const n=[...prev]; n[idx]=shape; return n }
        return [...prev,shape]
      })
    })
    socket.on("shape:delete", ({id}:any) => { if(id) setShapes(prev=>prev.filter(s=>s.id!==id)) })
    socket.on("shapes:bulk",  ({shapes:s}:any) => {
      if (!Array.isArray(s)) return
      setShapes(prev=>{ const m=new Map(prev.map(sh=>[sh.id,sh])); s.forEach((sh:Shape)=>m.set(sh.id,sh)); return Array.from(m.values()) })
    })
    socket.on("board:restore",({shapes:s}:any) => { setShapes(Array.isArray(s)?s:[]); setStatusMsg("✓ Restored"); setTimeout(()=>setStatusMsg(""),3000) })

    socket.on("cursor:update",(c:Cursor)=>setCursors(prev=>[...prev.filter(x=>x.socketId!==c.socketId),c]))
    socket.on("cursor:remove",({socketId}:any)=>setCursors(prev=>prev.filter(c=>c.socketId!==socketId)))
    socket.on("presence:update",({users}:any)=>{
      const seen=new Set<string>()
      setMembers((users||[]).filter((u:any)=>{ if(seen.has(u.id))return false; seen.add(u.id); return true }))
    })
    socket.on("board:my_info",({user}:any)=>setMyInfo(user))

    // Chat
    socket.on("chat:message", (msg:ChatMessage) => {
      setChatMessages(prev=>[...prev,msg])
      if (!showChat) setUnreadChat(n=>n+1)
    })

    // Reactions
    socket.on("reaction:stamp", ({x,y,emoji}:any) => {
      const r:Reaction={id:nanoId(),x,y,emoji,born:Date.now()}
      setReactions(prev=>[...prev,r])
    })

    socket.on("ai:result",  ({shapes:s}:any)=>{ setAiShapes(s); setAiLoading(false) })
    socket.on("ai:placed",  ()=>{setAiShapes(null);setAiPrompt("")})
    socket.on("ai:error",   ({msg}:any)=>{setStatusMsg(`AI: ${msg}`);setAiLoading(false);setTimeout(()=>setStatusMsg(""),5000)})
    socket.on("ai:describe_result",({text}:any)=>{setAiDescribe(text);setAiDescLoading(false)})
    socket.on("board:snapshot_saved",()=>{setStatusMsg("✓ Saved");setTimeout(()=>setStatusMsg(""),2000)})

    if (socket.connected) {
      setStatusMsg("Joining board...")
      socket.emit("board:join",{boardId})
    }

    return () => {
      socket.off("connect");socket.off("disconnect")
      socket.off("board:state");socket.off("shape:upsert");socket.off("shape:delete");socket.off("shapes:bulk");socket.off("board:restore")
      socket.off("cursor:update");socket.off("cursor:remove");socket.off("presence:update");socket.off("board:my_info")
      socket.off("chat:message");socket.off("reaction:stamp")
      socket.off("ai:result");socket.off("ai:placed");socket.off("ai:error");socket.off("ai:describe_result")
      socket.off("board:snapshot_saved")
      socket.emit("board:leave",{boardId})
      // Do NOT disconnect — keep the socket alive for fast next-board join
    }
  }, [ready,boardId])

  // Auto-scroll chat
  useEffect(() => { chatEndRef.current?.scrollIntoView({behavior:"smooth"}) }, [chatMessages])
  useEffect(() => { if (showChat) setUnreadChat(0) }, [showChat])

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const map:Record<string,Tool>={v:"select",r:"rect",e:"ellipse",d:"diamond",g:"triangle",y:"cylinder",t:"text",p:"pen",a:"arrow"}
    const onKey = (ev:KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement||ev.target instanceof HTMLTextAreaElement) return
      const t=map[ev.key.toLowerCase()]; if(t){setTool(t);return}
      if ((ev.key==="Delete"||ev.key==="Backspace")&&selected.length>0) { selected.forEach(id=>deleteShape(id)); setSelected([]); return }
      if ((ev.metaKey||ev.ctrlKey)&&ev.key==="s"){ev.preventDefault();connectSocket().emit("board:snapshot",{boardId,label:"Manual save"})}
      if (ev.key==="Escape"){setSelected([]);setPresentMode(false);setReactionMode(false)}
      if ((ev.metaKey||ev.ctrlKey)&&ev.key==="p"){ev.preventDefault();handlePresentStart()}
    }
    window.addEventListener("keydown",onKey)
    return ()=>window.removeEventListener("keydown",onKey)
  },[selected,boardId])

  // ── Shape ops ──
  const upsertShape = useCallback((shape:Shape) => {
    setShapes(prev=>{ const idx=prev.findIndex(s=>s.id===shape.id); if(idx>=0){const n=[...prev];n[idx]=shape;return n} return [...prev,shape] })
    connectSocket().emit("shape:upsert",{boardId,shape})
  },[boardId])

  const deleteShape = useCallback((id:string) => {
    setShapes(prev=>prev.filter(s=>s.id!==id))
    connectSocket().emit("shape:delete",{boardId,id})
  },[boardId])

  const broadcastCursor = useCallback((x:number,y:number) => {
    if(cursorThrottle.current) clearTimeout(cursorThrottle.current)
    cursorThrottle.current=setTimeout(()=>connectSocket().emit("cursor:move",{boardId,x:Math.round(x),y:Math.round(y)}),50)
  },[boardId])

  const broadcastReaction = useCallback((x:number,y:number,emoji:string) => {
    const r:Reaction={id:nanoId(),x,y,emoji,born:Date.now()}
    setReactions(prev=>[...prev,r])
    connectSocket().emit("reaction:stamp",{boardId,x,y,emoji})
  },[boardId])

  const updateSelected = useCallback((patch:Partial<Shape>) => {
    selected.forEach(id=>{ const s=shapesRef.current.find(sh=>sh.id===id); if(s) upsertShape({...s,...patch}) })
  },[selected,upsertShape])

  // ── Presentation mode ──
  const handlePresentStart = () => {
    const ids=shapes.filter(s=>s.type!=="pen"&&s.type!=="arrow").map(s=>s.id)
    if (ids.length===0) return
    setPresentList(ids); setPresentIdx(0); setPresentMode(true)
  }
  const presentNext = () => setPresentIdx(i=>Math.min(i+1,presentList.length-1))
  const presentPrev = () => setPresentIdx(i=>Math.max(i-1,0))
  const presentFocus = presentMode ? presentList[presentIdx] : null

  // ── AI ──
  const handleAIGenerate = () => {
    if (!aiPrompt.trim()||aiLoading) return
    setAiLoading(true)
    connectSocket().emit("ai:generate",{boardId,prompt:aiPrompt.trim()})
  }
  const handleAIPlace = () => {
    if (!aiShapes?.length) return
    setShapes(prev=>{ const m=new Map(prev.map(s=>[s.id,s])); aiShapes.forEach(s=>m.set(s.id,s)); return Array.from(m.values()) })
    connectSocket().emit("shapes:bulk",{boardId,shapes:aiShapes})
    setAiShapes(null); setAiPrompt("")
  }
  const handleAIDescribe = () => {
    const sel=shapesRef.current.filter(s=>selected.includes(s.id))
    if (sel.length===0) return
    setAiDescLoading(true); setAiDescribe("")
    const summary=sel.map(s=>`${s.type} labeled "${s.label||"(no label)"}" at (${Math.round(s.x)},${Math.round(s.y)})`).join("; ")
    connectSocket().emit("ai:describe",{boardId,summary,count:sel.length})
  }

  // ── Templates ──
  const applyTemplate = (name: keyof typeof TEMPLATES) => {
    const tpl = TEMPLATES[name]
    // Remap IDs to fresh ones
    const idMap: Record<string,string> = {}
    const newShapes: Shape[] = tpl.map(s => {
      const id = nanoId(); idMap[s.id]=id
      return {...s,id,points:s.points?[...s.points]:undefined}
    })
    // Fix arrow fromId/toId if they reference old ids
    newShapes.forEach(s=>{
      if(s.type==="arrow"&&s.points){
        // points are absolute, no remap needed
      }
    })
    setShapes(prev=>[...prev,...newShapes])
    connectSocket().emit("shapes:bulk",{boardId,shapes:newShapes})
    setShowTemplates(false)
    setStatusMsg(`✓ Template "${name}" added`)
    setTimeout(()=>setStatusMsg(""),2500)
  }

  // ── Chat ──
  const sendChat = (e:React.FormEvent) => {
    e.preventDefault()
    if (!chatInput.trim()) return
    connectSocket().emit("chat:message",{boardId,text:chatInput.trim()})
    setChatInput("")
  }

  // ── Version history ──
  const loadSnapshots = async () => {
    setShowVersions(true)
    setSnapshots([])   // clear while loading
    try {
      const d = await boardAPI.getSnapshots(boardId)
      const list = Array.isArray(d.snapshots) ? d.snapshots : []
      setSnapshots(list)   // already sorted newest-first by server
    } catch (err: any) {
      console.error("loadSnapshots:", err.message)
    }
  }
  const handleRewind = (index:number) => {
    connectSocket().emit("board:rewind",{boardId,snapshotIndex:index})
    setShowVersions(false)
    setStatusMsg("Restoring...")
  }

  // ── Share ──
  const openShare = () => { setShareLink(typeof window!=="undefined"?window.location.href:""); setShowShare(true) }
  const handleInvite = async (e:React.FormEvent) => {
    e.preventDefault(); if(!inviteEmail.trim()) return
    setInviting(true); setInviteMsg("")
    try { await boardAPI.addMember(boardId,inviteEmail.trim()); setInviteMsg(`✓ ${inviteEmail} added!`); setInviteEmail("") }
    catch(err:any){setInviteMsg(`✗ ${err.message}`)} finally{setInviting(false)}
  }

  // ── Analytics ──
  const analytics = shapes.reduce((acc,s) => {
    const key = s.createdBy || "unknown"
    if (!acc[key]) acc[key]={count:0,types:{}}
    acc[key].count++
    acc[key].types[s.type]=(acc[key].types[s.type]||0)+1
    return acc
  },{} as Record<string,{count:number;types:Record<string,number>}>)

  if (!ready) return <Loader />

  const dm=darkMode, bg=dm?"#0c0c10":"#f8f9fa", surface=dm?"#131318":"#ffffff", border=dm?"#22222e":"#e2e8f0", text=dm?"#eaeaf4":"#1a202c", muted=dm?"#58587a":"#64748b"
  const firstSel=shapes.find(s=>selected.includes(s.id))
  const effectiveTool = reactionMode ? "reaction" as any : tool

  return (
    <>
      <style>{getStyles(dm)}</style>
      <div style={{display:"flex",flexDirection:"column",height:"100vh",background:bg,overflow:"hidden",color:text}}>

        {/* ── TOPBAR ── */}
        <header className="topbar" style={{background:surface,borderColor:border}}>
          <button className="back-btn" style={{color:muted}} onClick={()=>router.push("/dashboard")}>← Dashboard</button>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div className={`status-dot${connected?" on":""}`} />
            <span style={{fontFamily:"var(--mono)",fontSize:13,fontWeight:500}}>{boardTitle||"Loading..."}</span>
          </div>
          {statusMsg&&<span className="status-pill">{statusMsg}</span>}

          <div className="topbar-right">
            {/* Presence */}
            <div style={{display:"flex"}}>
              {members.slice(0,5).map((m,i)=>(
                <div key={`${m.id}-${i}`} title={m.name} className="avatar" style={{background:m.color,marginLeft:i>0?-8:0}}>{m.name?.[0]?.toUpperCase()}</div>
              ))}
              {members.length>5&&<div className="avatar" style={{background:muted,marginLeft:-8,fontSize:9}}>+{members.length-5}</div>}
            </div>

            {/* Reactions */}
            <div style={{position:"relative"}}>
              <button className={`tb-btn${reactionMode?" active":""}`} onClick={()=>setReactionPicker(p=>!p)} title="Reaction stamps">
                {activeReaction}
              </button>
              {reactionPicker&&(
                <div style={{position:"absolute",top:"100%",right:0,marginTop:6,background:surface,border:`1px solid ${border}`,borderRadius:12,padding:8,display:"flex",gap:4,flexWrap:"wrap",width:160,zIndex:100,boxShadow:"0 4px 24px rgba(0,0,0,.3)"}}>
                  {REACTIONS.map(em=>(
                    <button key={em} onClick={()=>{setActiveReaction(em);setReactionMode(true);setReactionPicker(false)}}
                      style={{fontSize:18,background:"transparent",border:"none",cursor:"pointer",width:28,height:28,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center"}}
                      title={em}>{em}</button>
                  ))}
                  <button onClick={()=>{setReactionMode(false);setReactionPicker(false)}} style={{fontSize:10,background:"transparent",border:`1px solid ${border}`,color:muted,cursor:"pointer",width:"100%",borderRadius:6,padding:"3px 0",marginTop:4}}>Cancel</button>
                </div>
              )}
            </div>

            {/* Snap toggle */}
            <button className={`tb-btn${snapEnabled?" active":""}`} onClick={()=>setSnapEnabled(s=>!s)} title="Smart snap guides">
              ⊞ Snap
            </button>

            {/* Templates */}
            <button className="tb-btn" onClick={()=>setShowTemplates(true)} title="Diagram templates">⊞ Templates</button>

            {/* Present mode */}
            <button className={`tb-btn${presentMode?" active":""}`}
              onClick={()=>presentMode?setPresentMode(false):handlePresentStart()}
              title="Presentation mode (⌘P)">
              {presentMode?"✕ Exit":"▶ Present"}
            </button>

            {/* Chat */}
            <button className={`tb-btn${showChat?" active":""}`} onClick={()=>setShowChat(s=>!s)} title="Board chat">
              💬 {unreadChat>0&&!showChat&&<span style={{background:"#f87171",color:"#fff",borderRadius:10,padding:"0 5px",fontSize:9,marginLeft:3}}>{unreadChat}</span>}
            </button>

            <button className="tb-btn" onClick={()=>setShowAnalytics(s=>!s)} title="Analytics">📊</button>
            <button className="tb-btn accent" onClick={openShare}>⇗ Share</button>
            <button className={`tb-btn${showAI?" active":""}`} onClick={()=>setShowAI(s=>!s)}>✦ AI</button>
            <button className="tb-btn" onClick={loadSnapshots}>◷ History</button>
            <button className="tb-btn" onClick={()=>setDarkMode(d=>!d)}>{dm?"☀":"🌙"}</button>
            <button className="tb-btn" onClick={()=>{
              if(stageRef.current){const uri=stageRef.current.toDataURL({pixelRatio:2});const a=document.createElement("a");a.href=uri;a.download=`${boardTitle||"board"}.png`;a.click()}
            }}>↓ Export</button>
          </div>
        </header>

        {/* ── Presentation controls ── */}
        {presentMode&&(
          <div style={{position:"fixed",bottom:32,left:"50%",transform:"translateX(-50%)",zIndex:200,display:"flex",alignItems:"center",gap:12,background:surface,border:`1px solid ${border}`,borderRadius:40,padding:"10px 20px",boxShadow:"0 8px 32px rgba(0,0,0,.4)"}}>
            <button onClick={presentPrev} disabled={presentIdx===0} style={{background:"transparent",border:"none",color:presentIdx===0?muted:text,cursor:presentIdx===0?"not-allowed":"pointer",fontSize:18}}>◀</button>
            <span style={{fontFamily:"var(--mono)",fontSize:12,color:muted}}>{presentIdx+1} / {presentList.length}</span>
            <button onClick={presentNext} disabled={presentIdx>=presentList.length-1} style={{background:"transparent",border:"none",color:presentIdx>=presentList.length-1?muted:text,cursor:presentIdx>=presentList.length-1?"not-allowed":"pointer",fontSize:18}}>▶</button>
            <button onClick={()=>setPresentMode(false)} style={{background:"transparent",border:`1px solid ${border}`,color:muted,cursor:"pointer",borderRadius:20,padding:"3px 12px",fontSize:11,fontFamily:"var(--mono)"}}>Exit</button>
          </div>
        )}

        <div style={{display:"flex",flex:1,overflow:"hidden"}}>

          {/* ── LEFT TOOLBAR ── */}
          <aside className="sidebar" style={{background:surface,borderColor:border,color:text}}>
            {TOOLS.map(t=>(
              <button key={t.id} className={`tool-btn${tool===t.id&&!reactionMode?" active":""}`}
                onClick={()=>{setTool(t.id);setReactionMode(false)}} title={t.label}>{t.icon}</button>
            ))}
            <div className="divider" style={{background:border}} />
            <div style={{fontSize:9,color:muted,fontFamily:"var(--mono)",marginBottom:1}}>STK</div>
            {PALETTE.map(c=>(
              <button key={c} className="color-dot" onClick={()=>setStrokeColor(c)}
                style={{background:c,outline:strokeColor===c?"2px solid #fff":"2px solid transparent",outlineOffset:2}} />
            ))}
            <div className="divider" style={{background:border}} />
            <div style={{fontSize:9,color:muted,fontFamily:"var(--mono)",marginBottom:1}}>FILL</div>
            {FILL_PALETTE.map(c=>(
              <button key={`f${c}`} className="color-dot" onClick={()=>setFillColor(c)} title={c}
                style={{
                  background: c==="transparent"?(dm?"#1a1a22":"#f0f0f0"):c,
                  border: c==="transparent"?"2px dashed #4f46e5":"1px solid rgba(0,0,0,.2)",
                  outline: fillColor===c?"2px solid #4f46e5":"2px solid transparent",
                  outlineOffset:2
                }} />
            ))}
            <div className="divider" style={{background:border}} />
            {[1,2,3,4].map(w=>(
              <button key={w} onClick={()=>setStrokeW(w)} title={`${w}px`}
                style={{width:32,height:22,background:strokeW===w?"rgba(79,70,229,.15)":"transparent",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",borderRadius:6}}>
                <div style={{width:20,height:w+1,background:strokeW===w?"#4f46e5":muted,borderRadius:2}} />
              </button>
            ))}
          </aside>

          {/* ── CANVAS ── */}
          {mounted&&(
            <KonvaBoard
              stageRef={stageRef} shapes={shapes} cursors={cursors}
              tool={effectiveTool} strokeColor={strokeColor} fillColor={fillColor}
              strokeWidth={strokeW} fontSize={fontSize} fontStyle={fontStyle}
              selected={selected} setSelected={setSelected}
              upsertShape={upsertShape} deleteShape={deleteShape}
              broadcastCursor={broadcastCursor} broadcastReaction={broadcastReaction}
              boardId={boardId} darkMode={darkMode}
              presentMode={presentMode} presentFocus={presentFocus}
              reactions={reactions} snapEnabled={snapEnabled}
              reactionEmoji={activeReaction}
              reactionMode={reactionMode}
            />
          )}

          {/* ── PROPERTIES PANEL ── */}
          {selected.length>0&&(
            <aside className="props-panel" style={{background:surface,borderColor:border,color:text}}>
              <div className="panel-hdr" style={{borderColor:border}}>
                <span className="mono" style={{fontSize:11,color:"#6c63ff"}}>// properties</span>
                <button className="icon-btn" onClick={()=>setSelected([])}>✕</button>
              </div>
              <div style={{padding:"12px 14px",display:"flex",flexDirection:"column",gap:12,overflowY:"auto",flex:1}}>
                <p style={{fontSize:11,color:muted}}>{selected.length} shape{selected.length>1?"s":""} selected</p>

                <div>
                  <label className="prop-label" style={{color:muted}}>Fill</label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                    <button onClick={()=>updateSelected({fill:"transparent"})} style={{width:20,height:20,borderRadius:"50%",background:"transparent",border:"2px dashed #6c63ff",cursor:"pointer"}} />
                    {PALETTE.map(c=>(<button key={c} onClick={()=>updateSelected({fill:c})} style={{width:20,height:20,borderRadius:"50%",background:c,border:firstSel?.fill===c?"2px solid #fff":"none",cursor:"pointer"}} />))}
                  </div>
                </div>
                <div>
                  <label className="prop-label" style={{color:muted}}>Stroke</label>
                  <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                    {PALETTE.map(c=>(<button key={c} onClick={()=>updateSelected({stroke:c})} style={{width:20,height:20,borderRadius:"50%",background:c,border:firstSel?.stroke===c?"2px solid #fff":"none",cursor:"pointer"}} />))}
                  </div>
                </div>
                <div>
                  <label className="prop-label" style={{color:muted}}>Stroke width</label>
                  <input type="range" min="1" max="8" step="1" style={{width:"100%",marginTop:5}} value={firstSel?.strokeWidth||2} onChange={e=>updateSelected({strokeWidth:Number(e.target.value)})} />
                </div>
                <div>
                  <label className="prop-label" style={{color:muted}}>Opacity</label>
                  <input type="range" min="0.1" max="1" step="0.05" style={{width:"100%",marginTop:5}} value={firstSel?.opacity||1} onChange={e=>updateSelected({opacity:Number(e.target.value)})} />
                </div>
                {firstSel&&["text","rect","ellipse","diamond"].includes(firstSel.type)&&(<>
                  <div>
                    <label className="prop-label" style={{color:muted}}>Font size</label>
                    <input type="number" min="8" max="72" value={firstSel?.fontSize||14}
                      onChange={e=>updateSelected({fontSize:Number(e.target.value)})}
                      style={{width:"100%",background:dm?"#1a1a22":"#f1f5f9",color:text,border:`1px solid ${border}`,borderRadius:8,padding:"5px 8px",marginTop:5,outline:"none"}} />
                  </div>
                  <div>
                    <label className="prop-label" style={{color:muted}}>Style</label>
                    <div style={{display:"flex",gap:6,marginTop:5}}>
                      {(["normal","bold","italic"] as const).map(fs=>(
                        <button key={fs} onClick={()=>updateSelected({fontStyle:fs})}
                          style={{width:28,height:28,borderRadius:6,background:firstSel?.fontStyle===fs?"rgba(108,99,255,.15)":"transparent",border:`1px solid ${firstSel?.fontStyle===fs?"#6c63ff":border}`,color:firstSel?.fontStyle===fs?"#6c63ff":text,cursor:"pointer",fontSize:12}}>
                          {fs==="normal"?"N":fs==="bold"?"B":"I"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="prop-label" style={{color:muted}}>Text color</label>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:5}}>
                      {["#eaeaf4","#1a202c","#6c63ff","#22d3a0","#f87171","#fbbf24"].map(c=>(
                        <button key={c} onClick={()=>updateSelected({textColor:c})}
                          style={{width:20,height:20,borderRadius:"50%",background:c,border:firstSel?.textColor===c?"2px solid #6c63ff":"none",cursor:"pointer"}} />
                      ))}
                    </div>
                  </div>
                </>)}

                {/* AI Describe selected */}
                {selected.length>0&&(
                  <div style={{borderTop:`1px solid ${border}`,paddingTop:10}}>
                    <label className="prop-label" style={{color:muted,marginBottom:6,display:"block"}}>✦ AI describe selection</label>
                    <button onClick={handleAIDescribe} disabled={aiDescLoading}
                      style={{width:"100%",background:"rgba(108,99,255,.1)",border:"1px solid rgba(108,99,255,.3)",color:"#6c63ff",padding:"7px",borderRadius:8,fontSize:12,cursor:"pointer",fontFamily:"var(--sans)"}}>
                      {aiDescLoading?"Thinking...":"Explain this diagram"}
                    </button>
                    {aiDescribe&&(
                      <div style={{marginTop:8,fontSize:11,color:muted,lineHeight:1.6,background:dm?"#1a1a22":"#f8f9fa",borderRadius:8,padding:"8px 10px"}}>
                        {aiDescribe}
                      </div>
                    )}
                  </div>
                )}

                <button onClick={()=>{selected.forEach(id=>deleteShape(id));setSelected([])}}
                  style={{background:"rgba(248,113,113,.1)",border:"1px solid rgba(248,113,113,.3)",color:"#f87171",padding:"8px",borderRadius:10,fontSize:12,cursor:"pointer",marginTop:4}}>
                  Delete selected
                </button>
              </div>
            </aside>
          )}

          {/* ── AI PANEL ── */}
          {showAI&&(
            <aside className="side-panel" style={{background:surface,borderColor:border}}>
              <div className="panel-hdr" style={{borderColor:border}}>
                <span className="mono" style={{fontSize:11,color:"#6c63ff"}}>// AI diagram</span>
                <button className="icon-btn" onClick={()=>setShowAI(false)}>✕</button>
              </div>
              <div className="panel-body">
                <p style={{fontSize:12,color:muted,lineHeight:1.65}}>
                  Describe any diagram. AI builds it as a connected, labelled diagram. "ATM withdrawal", "user auth flow", "e-commerce microservices".
                </p>
                <textarea className="ai-input" rows={4}
                  style={{background:dm?"#1a1a22":"#f1f5f9",color:text,borderColor:border}}
                  placeholder="ATM withdrawal flowchart..."
                  value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)){e.preventDefault();handleAIGenerate()}}} />
                <p className="mono" style={{fontSize:10,color:muted,textAlign:"center"}}>⌘+Enter to generate</p>
                <button className={`ai-btn${!aiPrompt.trim()||aiLoading?" dim":""}`}
                  disabled={!aiPrompt.trim()||aiLoading} onClick={handleAIGenerate}>
                  {aiLoading?<><span className="spinner"/> Generating...</>:"✦ Generate diagram"}
                </button>
                {aiShapes&&(
                  <div className="ai-preview">
                    <span className="mono" style={{fontSize:11,color:"#22d3a0"}}>✓ {aiShapes.length} shapes ready</span>
                    <div style={{display:"flex",gap:8}}>
                      <button className="place-btn" onClick={handleAIPlace}>Place on canvas</button>
                      <button className="discard-btn" style={{borderColor:border,color:muted}} onClick={()=>{setAiShapes(null);setAiPrompt("")}}>Discard</button>
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* ── CHAT PANEL ── */}
          {showChat&&(
            <aside className="side-panel" style={{background:surface,borderColor:border,width:260}}>
              <div className="panel-hdr" style={{borderColor:border}}>
                <span className="mono" style={{fontSize:11,color:"#6c63ff"}}>// board chat</span>
                <button className="icon-btn" onClick={()=>setShowChat(false)}>✕</button>
              </div>
              <div style={{flex:1,overflowY:"auto",padding:"10px 12px",display:"flex",flexDirection:"column",gap:8}}>
                {chatMessages.length===0&&(
                  <p style={{fontSize:12,color:muted,textAlign:"center",marginTop:20}}>No messages yet. Say hi to your collaborators!</p>
                )}
                {chatMessages.map(m=>(
                  <div key={m.id} style={{display:"flex",flexDirection:"column",gap:3}}>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <div style={{width:16,height:16,borderRadius:"50%",background:m.color,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#fff",fontWeight:700}}>{m.name[0]?.toUpperCase()}</div>
                      <span style={{fontSize:10,color:muted,fontFamily:"var(--mono)"}}>{m.name}</span>
                      <span style={{fontSize:9,color:muted,fontFamily:"var(--mono)",marginLeft:"auto"}}>{new Date(m.ts).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</span>
                    </div>
                    <div style={{background:dm?"#1a1a22":"#f1f5f9",borderRadius:8,padding:"7px 10px",fontSize:13,lineHeight:1.5,marginLeft:22}}>
                      {m.text}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <form onSubmit={sendChat} style={{padding:"10px 12px",borderTop:`1px solid ${border}`,display:"flex",gap:8}}>
                <input value={chatInput} onChange={e=>setChatInput(e.target.value)}
                  placeholder="Message..." autoComplete="off"
                  style={{flex:1,background:dm?"#1a1a22":"#f1f5f9",border:`1px solid ${border}`,borderRadius:8,padding:"7px 10px",fontSize:12,color:text,outline:"none",fontFamily:"var(--sans)"}} />
                <button type="submit" style={{background:"#6c63ff",border:"none",color:"#fff",borderRadius:8,padding:"7px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>↑</button>
              </form>
            </aside>
          )}

          {/* ── ANALYTICS PANEL ── */}
          {showAnalytics&&(
            <aside className="side-panel" style={{background:surface,borderColor:border,width:240}}>
              <div className="panel-hdr" style={{borderColor:border}}>
                <span className="mono" style={{fontSize:11,color:"#6c63ff"}}>// analytics</span>
                <button className="icon-btn" onClick={()=>setShowAnalytics(false)}>✕</button>
              </div>
              <div style={{padding:"14px",display:"flex",flexDirection:"column",gap:14}}>
                <div style={{background:dm?"#1a1a22":"#f1f5f9",borderRadius:10,padding:"12px"}}>
                  <p style={{fontSize:11,color:muted,fontFamily:"var(--mono)",marginBottom:6}}>Total shapes</p>
                  <p style={{fontSize:28,fontWeight:800,letterSpacing:"-1px"}}>{shapes.length}</p>
                </div>
                <div style={{background:dm?"#1a1a22":"#f1f5f9",borderRadius:10,padding:"12px"}}>
                  <p style={{fontSize:11,color:muted,fontFamily:"var(--mono)",marginBottom:8}}>By collaborator</p>
                  {Object.entries(analytics).map(([uid,data])=>{
                    const member=members.find(m=>m.id===uid)
                    const color=member?.color||"#6c63ff"
                    const name=member?.name||"Anonymous"
                    return (
                      <div key={uid} style={{marginBottom:8}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <div style={{width:8,height:8,borderRadius:"50%",background:color}} />
                            <span style={{fontSize:12}}>{name}</span>
                          </div>
                          <span style={{fontSize:12,color:muted,fontFamily:"var(--mono)"}}>{data.count}</span>
                        </div>
                        <div style={{height:4,background:dm?"#22222e":"#e2e8f0",borderRadius:2}}>
                          <div style={{height:"100%",width:`${(data.count/shapes.length)*100}%`,background:color,borderRadius:2,transition:"width .5s"}} />
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{background:dm?"#1a1a22":"#f1f5f9",borderRadius:10,padding:"12px"}}>
                  <p style={{fontSize:11,color:muted,fontFamily:"var(--mono)",marginBottom:8}}>By type</p>
                  {Object.entries(shapes.reduce((a,s)=>{a[s.type]=(a[s.type]||0)+1;return a},{} as Record<string,number>))
                    .sort((a,b)=>b[1]-a[1])
                    .map(([type,count])=>(
                    <div key={type} style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                      <span style={{fontSize:12,color:muted}}>{type}</span>
                      <span style={{fontSize:12,fontFamily:"var(--mono)"}}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* ── TEMPLATES MODAL ── */}
      {showTemplates&&(
        <div className="overlay" onClick={()=>setShowTemplates(false)}>
          <div className="modal" style={{background:surface,borderColor:border,color:text,maxWidth:520}} onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><h3>Diagram templates</h3><button className="icon-btn" onClick={()=>setShowTemplates(false)}>✕</button></div>
            <p style={{fontSize:12,color:muted,marginBottom:18}}>Drop a pre-built diagram onto your canvas and customise it.</p>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
              {(Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).map(name=>(
                <button key={name} onClick={()=>applyTemplate(name)}
                  style={{background:dm?"#1a1a22":"#f1f5f9",border:`1px solid ${border}`,borderRadius:12,padding:"18px 14px",cursor:"pointer",textAlign:"center",transition:"all .15s",display:"flex",flexDirection:"column",gap:8,alignItems:"center"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#6c63ff";e.currentTarget.style.background="rgba(108,99,255,.08)"}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=border;e.currentTarget.style.background=dm?"#1a1a22":"#f1f5f9"}}>
                  <span style={{fontSize:24}}>{name==="Basic flowchart"?"⬡":name==="ERD starter"?"⊞":"⊜"}</span>
                  <span style={{fontSize:12,fontWeight:600,color:text}}>{name}</span>
                  <span style={{fontSize:10,color:muted}}>{TEMPLATES[name].length} shapes</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── SHARE MODAL ── */}
      {showShare&&(
        <div className="overlay" onClick={()=>{setShowShare(false);setInviteMsg("")}}>
          <div className="modal" style={{background:surface,borderColor:border,color:text}} onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><h3>Share &amp; invite</h3><button className="icon-btn" onClick={()=>setShowShare(false)}>✕</button></div>
            <p style={{fontSize:12,color:muted,marginBottom:7}}>Board link:</p>
            <div style={{display:"flex",gap:8,marginBottom:18}}>
              <div style={{flex:1,background:dm?"#1a1a22":"#f1f5f9",border:`1px solid ${border}`,borderRadius:10,padding:"8px 12px",fontFamily:"var(--mono)",fontSize:10,color:muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{shareLink}</div>
              <button style={{background:"#6c63ff",border:"none",color:"#fff",padding:"8px 16px",borderRadius:10,fontSize:12,fontWeight:700,cursor:"pointer"}}
                onClick={()=>{navigator.clipboard.writeText(shareLink);setCopiedLink(true);setTimeout(()=>setCopiedLink(false),2000)}}>{copiedLink?"✓":"Copy"}</button>
            </div>
            <p style={{fontSize:12,color:muted,marginBottom:7}}>Invite as editor:</p>
            <form onSubmit={handleInvite} style={{display:"flex",flexDirection:"column",gap:10}}>
              <input style={{background:dm?"#1a1a22":"#f1f5f9",border:`1px solid ${border}`,color:text,borderRadius:10,padding:"10px 13px",fontSize:13,fontFamily:"var(--mono)",outline:"none",width:"100%"}}
                type="email" placeholder="teammate@example.com" value={inviteEmail} onChange={e=>{setInviteEmail(e.target.value);setInviteMsg("")}} required />
              {inviteMsg&&<p className="mono" style={{fontSize:12,color:inviteMsg.startsWith("✓")?"#22d3a0":"#f87171"}}>{inviteMsg}</p>}
              <button type="submit" style={{background:"#6c63ff",border:"none",color:"#fff",padding:"11px",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer"}} disabled={inviting}>{inviting?"Sending...":"Send invite →"}</button>
            </form>
            {members.length>0&&(
              <>
                <p style={{fontSize:12,color:muted,marginTop:18,marginBottom:8}}>Online ({members.length}):</p>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {members.map(m=>(
                    <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,background:dm?"#1a1a22":"#f1f5f9",borderRadius:10,padding:"8px 12px"}}>
                      <div style={{width:22,height:22,borderRadius:"50%",background:m.color,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff"}}>{m.name?.[0]?.toUpperCase()}</div>
                      <span style={{fontSize:13}}>{m.name}</span>
                      <div style={{width:6,height:6,borderRadius:"50%",background:"#22d3a0",marginLeft:"auto"}} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── VERSION HISTORY ── */}
      {showVersions&&(
        <div className="overlay" onClick={()=>setShowVersions(false)}>
          <div className="modal" style={{background:surface,borderColor:border,color:text}} onClick={e=>e.stopPropagation()}>
            <div className="modal-hdr"><h3>Version history</h3><button className="icon-btn" onClick={()=>setShowVersions(false)}>✕</button></div>
            <div style={{display:"flex",flexDirection:"column",gap:8,maxHeight:"50vh",overflowY:"auto"}}>
              {snapshots.length===0?<p className="mono" style={{fontSize:12,color:muted,padding:"8px 0"}}>No saved versions yet. Board auto-saves every 60s, or press Ctrl+S to save now.</p>
                :snapshots.map(s=>(
                <div key={s.index} style={{display:"flex",alignItems:"center",gap:12,background:dm?"#1a1a22":"#f1f5f9",border:`1px solid ${border}`,borderRadius:10,padding:"10px 12px"}}>
                  <div style={{flex:1}}>
                    <p style={{fontSize:13,fontWeight:500}}>{s.label}</p>
                    <p className="mono" style={{fontSize:10,color:muted,marginTop:2}}>{new Date(s.savedAt).toLocaleString()}</p>
                  </div>
                  <button onClick={()=>handleRewind(s.index)} style={{background:"#6c63ff",border:"none",color:"#fff",padding:"5px 12px",borderRadius:10,fontSize:11,fontWeight:700,cursor:"pointer"}}>Restore</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Loader() {
  return (
    <div style={{minHeight:"100vh",background:"#0c0c10",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <style>{`@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>
      <div style={{display:"flex",gap:6}}>
        {[0,1,2].map(i=><span key={i} style={{width:7,height:7,borderRadius:"50%",background:"#6c63ff",animation:`pulse 1.2s ease-in-out ${i*.18}s infinite`}} />)}
      </div>
    </div>
  )
}

function getStyles(dm: boolean) {
  return `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Cabinet+Grotesk:wght@400;500;700;800;900&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--mono:'DM Mono',monospace;--sans:'Cabinet Grotesk',sans-serif;--r:10px;--rl:14px}
html,body{height:100%;overflow:hidden}
body{font-family:var(--sans);-webkit-font-smoothing:antialiased}
button{cursor:pointer;font-family:var(--sans)}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:#2e2e3e;border-radius:2px}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes popIn{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}
.mono{font-family:var(--mono)}
.topbar{display:flex;align-items:center;gap:8px;padding:0 12px;height:50px;border-bottom:1px solid;flex-shrink:0;z-index:10;overflow-x:auto}
.back-btn{background:transparent;border:none;font-family:var(--mono);font-size:12px;cursor:pointer;transition:color .15s;white-space:nowrap}
.status-dot{width:7px;height:7px;border-radius:50%;background:#f87171;flex-shrink:0;transition:all .3s}
.status-dot.on{background:#22d3a0;box-shadow:0 0 6px #22d3a0}
.status-pill{font-family:var(--mono);font-size:11px;color:#22d3a0;background:rgba(34,211,160,.08);border:1px solid rgba(34,211,160,.2);border-radius:20px;padding:3px 10px;animation:fadeIn .2s ease;white-space:nowrap;flex-shrink:0}
.topbar-right{display:flex;align-items:center;gap:6px;margin-left:auto;flex-shrink:0}
.avatar{width:24px;height:24px;border-radius:50%;border:2px solid transparent;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:#fff;font-family:var(--mono);flex-shrink:0}
.tb-btn{background:transparent;border:1px solid;padding:4px 10px;border-radius:var(--r);font-size:11px;transition:all .15s;white-space:nowrap;flex-shrink:0}
.tb-btn.active{border-color:rgba(79,70,229,.5)!important;color:#4f46e5!important;background:rgba(79,70,229,.1)!important}
.tb-btn.accent{background:#6c63ff;border:none;color:#fff;font-weight:700}
.sidebar{width:50px;border-right:1px solid;display:flex;flex-direction:column;align-items:center;padding:8px 0;gap:3px;flex-shrink:0;z-index:5;overflow-y:auto}
.tool-btn{width:34px;height:34px;border-radius:var(--r);background:transparent;border:1px solid transparent;font-size:14px;display:flex;align-items:center;justify-content:center;transition:all .15s;flex-shrink:0;color:inherit}
.tool-btn.active{background:rgba(79,70,229,.15);border-color:rgba(79,70,229,.5);color:#4f46e5}
.color-dot{width:20px;height:20px;border-radius:50%;border:none;cursor:pointer;flex-shrink:0;transition:transform .15s}
.color-dot:hover{transform:scale(1.18);z-index:1;position:relative}
.divider{width:28px;height:1px;margin:3px 0;flex-shrink:0}
.props-panel{width:210px;border-left:1px solid;display:flex;flex-direction:column;flex-shrink:0}
.side-panel{width:280px;border-left:1px solid;display:flex;flex-direction:column;flex-shrink:0;animation:slideR .25s cubic-bezier(.22,1,.36,1)}
@keyframes slideR{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}
.panel-hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid;flex-shrink:0}
.panel-body{padding:14px;display:flex;flex-direction:column;gap:11px;flex:1;overflow-y:auto}
.icon-btn{background:transparent;border:none;cursor:pointer;font-size:14px;line-height:1}
.ai-input{border:1px solid;border-radius:var(--r);padding:10px 12px;font-size:12px;font-family:var(--mono);resize:none;outline:none;width:100%}
.ai-btn{background:#6c63ff;border:none;color:#fff;padding:11px;border-radius:var(--r);font-size:13px;font-weight:700;width:100%;display:flex;align-items:center;justify-content:center;gap:8px;font-family:var(--sans)}
.ai-btn.dim{background:#2e2e3e;color:#58587a;cursor:not-allowed}
.spinner{width:12px;height:12px;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite;display:inline-block;flex-shrink:0}
.ai-preview{border:1px solid rgba(108,99,255,.3);border-radius:var(--r);padding:12px;background:rgba(108,99,255,.05);display:flex;flex-direction:column;gap:10px}
.place-btn{flex:1;background:#6c63ff;border:none;color:#fff;padding:9px;border-radius:var(--r);font-size:12px;font-weight:700;cursor:pointer}
.discard-btn{background:transparent;border:1px solid;padding:9px 12px;border-radius:var(--r);font-size:12px;cursor:pointer}
.prop-label{font-size:11px;font-family:var(--mono);letter-spacing:.04em;display:block}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:200;backdrop-filter:blur(4px);animation:fadeIn .15s ease}
.modal{border:1px solid;border-radius:var(--rl);padding:24px 26px;max-width:400px;width:90%;animation:popIn .2s cubic-bezier(.22,1,.36,1);max-height:85vh;overflow-y:auto}
.modal-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.modal-hdr h3{font-size:17px;font-weight:700}
`
}