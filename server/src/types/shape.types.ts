// server/src/types/shape.types.ts
// This is NOT a Mongoose model — it's a TypeScript interface.
// Shapes live inside a Yjs Y.Map, not in MongoDB.
// Place this file at: server/src/types/shape.types.ts

export type ShapeType = "rect" | "ellipse" | "path" | "text" | "arrow"

export interface Shape {
  id:        string          // nanoid — Yjs Y.Map key
  type:      ShapeType
  x:         number
  y:         number
  width:     number
  height:    number
  fill:      string          // hex color
  stroke:    string          // hex color
  strokeWidth: number
  opacity:   number          // 0–1
  rotation:  number          // degrees
  text?:     string          // only for type === "text"
  fontSize?: number          // only for type === "text"
  points?:   number[]        // only for type === "path" — flat [x1,y1,x2,y2,...]
  fromId?:   string          // only for type === "arrow" — source shape id
  toId?:     string          // only for type === "arrow" — target shape id
  createdBy: string          // userId
  createdAt: number          // Date.now() timestamp
}

// What the AI returns for each node/edge — server maps this to Shape[]
export interface AIShapeRaw {
  type:   ShapeType
  x:      number
  y:      number
  width:  number
  height: number
  label?: string
  color?: string
  from?:  number   // index into shapes array (for arrows)
  to?:    number
}