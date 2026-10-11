import { PARAMETERS as P, emptyResult } from './shared-segment-assessment-contracts.ts';
import type { AssessmentResult, SupportInterval } from './shared-segment-assessment-contracts.ts';

type V = [number, number, number];
type Point = { v: V; position: number };
type Segment = { a: Point; b: Point; d: V; length: number };
const add = (a: V, b: V): V => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const sub = (a: V, b: V): V => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const scale = (a: V, n: number): V => [a[0]*n, a[1]*n, a[2]*n];
const dot = (a: V, b: V) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm = (a: V) => Math.hypot(...a);
const unit = (a: V) => scale(a, 1/norm(a));
const cross = (a: V, b: V): V => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const angle = (a: V,b: V) => Math.atan2(norm(cross(a,b)),dot(a,b));
const lerp = (a: V,b: V,t: number) => add(a,scale(sub(b,a),t));
class Limit extends Error {}
class Invalid extends Error {}
const round = (v: number) => Math.round(v*1e6)/1e6;

function route(shape: unknown): Point[] {
  if (!shape || typeof shape!=='object' || Array.isArray(shape)) throw new Invalid();
  const s=shape as Record<string,unknown>;
  if (Object.keys(s).sort().join(',')!=='coordinates,type' || s.type!=='LineString' || !Array.isArray(s.coordinates) || s.coordinates.length<2) throw new Invalid();
  if(s.coordinates.length>P.maximumOriginalCoordinates) throw new Limit();
  let position=0;
  const raw: Point[]=[];
  for(const c of s.coordinates) {
    if(!Array.isArray(c) || c.length!==2 || !c.every(n=>typeof n==='number' && Number.isFinite(n)) || Math.abs(c[0])>180 || Math.abs(c[1])>90) throw new Invalid();
    const lon=c[0]*Math.PI/180,lat=c[1]*Math.PI/180;
    const v: V=scale([Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)],P.earthRadiusMeters);
    if(raw.length) {
      const arc=angle(raw[raw.length-1].v,v);
      if(arc>=Math.PI-1e-12) throw new Invalid(); // Antipodal arcs lack unique interpolation.
      const length=arc*P.earthRadiusMeters;
      if(length===0) continue;
      position+=length;
    }
    raw.push({v,position});
  }
  if(raw.length<2 || position<=P.numericalEpsilonMeters) throw new Invalid();
  if(Math.ceil((position-P.numericalEpsilonMeters)/P.samplingSpacingMeters)+1>P.maximumResampledPoints) throw new Limit();
  const points: Point[]=[raw[0]];
  let station=P.samplingSpacingMeters;
  for(let i=1;i<raw.length;i++) {
    const a=raw[i-1],b=raw[i],arc=angle(a.v,b.v);
    while(station<b.position-P.numericalEpsilonMeters) {
      if(station>a.position+P.numericalEpsilonMeters) {
        const t=(station-a.position)/(b.position-a.position);
        const v=scale(add(scale(unit(a.v),Math.sin((1-t)*arc)),scale(unit(b.v),Math.sin(t*arc))),P.earthRadiusMeters/Math.sin(arc));
        points.push({v,position:station});
      }
      station+=P.samplingSpacingMeters;
      if(points.length>=P.maximumResampledPoints) throw new Limit();
    }
    points.push(b); // Preserve every turn. Never interpolate across an original vertex.
    if(Math.abs(station-b.position)<=P.numericalEpsilonMeters) station+=P.samplingSpacingMeters;
    if(points.length>P.maximumResampledPoints) throw new Limit();
  }
  return points;
}
function segments(points: Point[]): Segment[] {
  return points.slice(1).map((b,i)=>({a:points[i],b,d:sub(b.v,points[i].v),length:b.position-points[i].position}));
}
// Expanded ECEF chord boxes in 5m cells. Segments are <=5m; box size is bounded.
function cells(s: Segment, padding: number): string[] {
  const ranges=s.a.v.map((n,i)=>[Math.floor((Math.min(n,s.b.v[i])-padding)/5),Math.floor((Math.max(n,s.b.v[i])+padding)/5)]);
  const out:string[]=[];
  for(let x=ranges[0][0];x<=ranges[0][1];x++) for(let y=ranges[1][0];y<=ranges[1][1];y++) for(let z=ranges[2][0];z<=ranges[2][1];z++) out.push(`${x},${y},${z}`);
  return out;
}
// Clip the source chord to forward projected target positions and the 5m tube.
// Unlike nearest-point matching, every plausible target segment is retained.
function correspondence(a: Segment,b: Segment): { interval: SupportInterval; heading: number } | null {
  const den=dot(b.d,b.d),w=sub(a.a.v,b.a.v);
  const u0=dot(w,b.d)/den,k=dot(a.d,b.d)/den;
  if(Math.abs(k)<1e-12) return null;
  let lo=Math.max(0,Math.min(-u0/k,(1-u0)/k)),hi=Math.min(1,Math.max(-u0/k,(1-u0)/k));
  if(hi<=lo) return null;
  const q=sub(w,scale(b.d,u0)),v=sub(a.d,scale(b.d,k));
  const A=dot(v,v),B=2*dot(q,v),C=dot(q,q)-P.proximityMeters**2;
  if(A<1e-20) { if(C>0) return null; }
  else { const disc=B*B-4*A*C; if(disc<0) return null; const root=Math.sqrt(disc);lo=Math.max(lo,(-B-root)/(2*A));hi=Math.min(hi,(-B+root)/(2*A)); }
  if((hi-lo)*a.length<=P.numericalEpsilonMeters) return null;
  let heading=0;
  for(const t of [lo,(lo+hi)/2,hi]) {
    const pa=unit(lerp(a.a.v,a.b.v,t)),pb=unit(lerp(b.a.v,b.b.v,u0+k*t));
    const da=sub(a.d,scale(pa,dot(a.d,pa))),db=sub(b.d,scale(pb,dot(b.d,pb)));
    heading=Math.max(heading,angle(da,db)*180/Math.PI);
  }
  return {interval:{chain:0,offererStart:a.a.position+lo*a.length,offererEnd:a.a.position+hi*a.length,
    requesterStart:b.a.position+(u0+k*lo)*b.length,requesterEnd:b.a.position+(u0+k*hi)*b.length},heading};
}
function unionLength(intervals: [number,number][]): number {
  intervals.sort((a,b)=>a[0]-b[0] || a[1]-b[1]);
  let total=0,start=0,end=0;
  for(const [a,b] of intervals) { if(a>end) {total+=end-start;start=a;end=b;} else end=Math.max(end,b); }
  return total+end-start;
}
export function assessSharedSegment(offererShape: unknown,requesterShape: unknown): AssessmentResult {
  const r=emptyResult();
  const work=()=>{if(r.workUnits>=P.maximumWorkUnits) throw new Limit();r.workUnits++;};
  try {
    const a=route(offererShape),b=route(requesterShape);
    r.offererPointCount=a.length;r.requesterPointCount=b.length;
    r.offererTotal=a[a.length-1].position;r.requesterTotal=b[b.length-1].position;
    const aa=segments(a),bb=segments(b),grid=new Map<string,number[]>();
    for(let i=0;i<bb.length;i++) for(const key of cells(bb[i],0)) { work();const bucket=grid.get(key);if(bucket)bucket.push(i);else grid.set(key,[i]); }
    const matches: SupportInterval[]=[];
    for(const s of aa) {
      const candidates=new Set<number>();
      for(const key of cells(s,P.proximityMeters)) {work();for(const i of grid.get(key)??[]) {work();candidates.add(i);} }
      for(const i of [...candidates].sort((x,y)=>x-y)) {
        work();const m=correspondence(s,bb[i]);if(!m)continue;
        const headingBound=(s.length+bb[i].length)/P.earthRadiusMeters*180/Math.PI;
        if(m.heading+headingBound<=P.maximumHeadingDegrees && m.interval.requesterEnd>m.interval.requesterStart+P.numericalEpsilonMeters) {
          if(matches.length>=P.maximumStoredIntervals)throw new Limit();
          matches.push(m.interval);r.sameDirectionCount++;
        }
        else if(m.heading>=180-P.maximumHeadingDegrees)r.reverseDirectionCount++;
      }
    }
    // Sweep both axes. Multiple separated intervals are not ambiguity. Material
    // alternative positions on overlapping support are, including repeats on either route.
    for(const axis of ['offerer','requester'] as const) {
      const other=axis==='offerer'?'requester':'offerer';
      const sorted=[...matches].sort((x,y)=>x[`${axis}Start`]-y[`${axis}Start`] || x[`${other}Start`]-y[`${other}Start`]);
      const active:SupportInterval[]=[];
      for(const m of sorted) {
        for(let i=active.length-1;i>=0;i--) {work();if(active[i][`${axis}End`]<=m[`${axis}Start`]+P.numericalEpsilonMeters)active.splice(i,1);}
        for(const n of active) {
          work();const x=Math.max(m[`${axis}Start`],n[`${axis}Start`]);
          const project=(v:SupportInterval)=>v[`${other}Start`]+(x-v[`${axis}Start`])/(v[`${axis}End`]-v[`${axis}Start`])*(v[`${other}End`]-v[`${other}Start`]);
          if(Math.abs(project(m)-project(n))>P.maximumUnsupportedGapMeters)r.ambiguityCount++;
        }
        active.push(m);
      }
    }
    matches.sort((x,y)=>x.offererStart-y.offererStart || x.requesterStart-y.requesterStart || x.offererEnd-y.offererEnd);
    const chains:{pieces:SupportInterval[];end:SupportInterval}[]=[];
    for(const m of matches) {
      let chosen:typeof chains[number]|undefined;
      // Only recent offerer-position chains can connect; expire older chains
      // from lookup without discarding their independent supported intervals.
      for(let i=chains.length-1;i>=0;i--) {
        work();const c=chains[i],e=c.end;
        if(m.offererStart-e.offererEnd>P.maximumUnsupportedGapMeters)continue;
        if(m.offererEnd>=e.offererEnd-P.numericalEpsilonMeters && m.requesterEnd>=e.requesterEnd-P.numericalEpsilonMeters &&
          m.requesterStart-e.requesterEnd<=P.maximumUnsupportedGapMeters && m.requesterStart>=e.requesterStart-P.numericalEpsilonMeters) { chosen=c;break; }
      }
      if(chosen) {chosen.pieces.push(m);chosen.end=m;} else chains.push({pieces:[m],end:m});
    }
    r.offererSupported=unionLength(matches.map(m=>[m.offererStart,m.offererEnd]));
    r.requesterSupported=unionLength(matches.map(m=>[m.requesterStart,m.requesterEnd]));
    let positive=false;
    for(const [chain,c] of chains.entries()) {
      for(const m of c.pieces)m.chain=chain;
      const ol=unionLength(c.pieces.map(m=>[m.offererStart,m.offererEnd])),rl=unionLength(c.pieces.map(m=>[m.requesterStart,m.requesterEnd]));
      if(ol+P.numericalEpsilonMeters>=100 && rl+P.numericalEpsilonMeters>=100)positive=true;
    }
    // Persist actual union intervals, not bounding spans across permitted gaps.
    if(matches.length>P.maximumStoredIntervals)throw new Limit();
    r.supportIntervals=matches;
    r.assessmentState='complete';
    r.geographicResult=r.ambiguityCount?'overlap_observed':positive?'geometric_corridor_support':matches.length?'overlap_observed':'inconclusive';
    r.reasons=r.ambiguityCount?['ambiguous_traversal']:positive?[]:matches.length?['below_positive_support_standard']:r.reverseDirectionCount?['reverse_direction_only']:['no_positive_support_on_reference_route'];
    r.offererFraction=r.offererSupported/r.offererTotal;r.requesterFraction=r.requesterSupported/r.requesterTotal;
    // Rounding is output-only. All correspondence and threshold decisions above
    // retain cumulative double precision. Never round positions to whole metres.
    for(const key of ['offererTotal','requesterTotal','offererSupported','requesterSupported','offererFraction','requesterFraction'] as const)r[key]=round(r[key]);
    r.supportIntervals=r.supportIntervals.map(m=>({chain:m.chain,offererStart:round(m.offererStart),offererEnd:round(m.offererEnd),requesterStart:round(m.requesterStart),requesterEnd:round(m.requesterEnd)}));
    return r;
  } catch(e) {
    const failure=emptyResult(e instanceof Invalid?'evidence_invalid':'ready');
    failure.assessmentState=e instanceof Invalid?'not_run':'assessment_unavailable';
    failure.reasons=e instanceof Limit?['processing_limit']:e instanceof Invalid?[]:['calculation_failed'];
    failure.workUnits=r.workUnits;failure.offererPointCount=r.offererPointCount;failure.requesterPointCount=r.requesterPointCount;
    return failure;
  }
}
