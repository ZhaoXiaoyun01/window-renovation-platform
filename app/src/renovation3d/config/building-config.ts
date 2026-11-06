import type { BuildingConfig, Evidence, Facade, FinishZone, Floor, Opening, Part, Vec3, Wall } from '../types';
import { clipHoles, intersect } from '../tile-layout/layout.ts';
import { reliefReturns } from '../utils/relief-returns.ts';
import { exteriorSurfaces } from '../utils/exterior-surfaces.ts';

const evidence = (page: number, note: string, status: Evidence['status'] = 'pending'): Evidence => ({ page, status, note });
const floors: Floor[] = [
  { id: 'f1', label: '一层', elevationMm: 0, heightMm: 3800, footprintMm: { width: 10260, depth: 12260, centerZ: 0 }, evidence: evidence(1, '一层前宽10260、北宽10200、深12260；矩形包络按前宽，北侧差异待复核。', 'drawing') },
  { id: 'f2', label: '二层', elevationMm: 3800, heightMm: 3300, footprintMm: { width: 10320, depth: 12260, centerZ: 0 }, evidence: evidence(2, '后宽10320、前宽10200、深12260；矩形包络按后宽，前侧差异待复核。', 'drawing') },
  { id: 'f3', label: '三层', elevationMm: 7100, heightMm: 3300, footprintMm: { width: 10320, depth: 12320, centerZ: 0 }, evidence: evidence(3, '三层10320×12320。', 'drawing') },
  { id: 'f4', label: '四层', elevationMm: 10400, heightMm: 3300, footprintMm: { width: 10320, depth: 6700, centerZ: -2810 }, evidence: evidence(4, '四层楼面10320×12320；屋檐按侧立面6700+60，前墙西段按平面退入2200。平面轴线与立面外缘不能完全对应，定位待复核。') },
];
// White frames stand 60 mm proud of the grey body: PDF pages 5, 7 and 8.
const reliefMm = 60;
const facadeEnvelope = { width: 10320, depth: 12320 };
const structureInsetMm = reliefMm;
const baseProjectionMm = 1000;
const tileDepthMm = 8;
const groundRingBeamHeightMm = 500;
const balcony = { x: 4350, width: 5500, depth: 1600, thickness: 200 };
const balconySide = { y: 100, height: 2700, railHeight: 1000, railThickness: 60, railBase: 120, railFrontInset: 70 };
const upperWallThicknessMm = 260;
const openingDepthMm = 100;
const terraceWindowLeftInsetMm = 240;
const entrance = { platformDepthMm: 900, riseMm: 150, treadMm: 300, risers: 3, stairWidthMm: 1800, stairCenterX: 1290, groundMm: -450 };
const terrace = { north: -6160, wallFront: 540, roofFront: 600, south: 6160, partitionX: 700, recessDepth: 2200, floorThickness: 180, parapetThickness: 160, parapetHeight: 1200, roofElevation: 13700, roofFasciaHeight: 500 };
const cornerJamb = { frontWidthMm: 400, sideDepthMm: 300, southMm: facadeEnvelope.depth / 2 - reliefMm, eastMm: facadeEnvelope.width / 2 - reliefMm };
const cornerInnerX = cornerJamb.eastMm - cornerJamb.frontWidthMm;
const entranceScreen = { startMm: reliefMm + cornerJamb.sideDepthMm, widthMm: 1200, heightMm: floors[0].heightMm - groundRingBeamHeightMm,
  depthMm: 200, slatWidthMm: 40, gapMm: 80, frameWidthMm: 40, color: '#333d3f' };
const zone = (x: number, y: number, width: number, height: number, materialId: string, offsetMm = materialId === 'basalt' ? -reliefMm : 0): FinishZone => ({ x, y, width, height, materialId, offsetMm });
const op = (id: string, x: number, y: number, width: number, height: number, page: number, kind: Opening['kind'] = 'window'): Opening => ({ id, x, y, width, height, kind, evidence: evidence(page, '宽高按可读标注；未完整标注的定位按图比例，需复核。') });
const walls: Wall[] = [];
for (const f of floors) {
  const w = facadeEnvelope.width, d = f.id === 'f4' ? f.footprintMm.depth : facadeEnvelope.depth;
  const z = f.id === 'f4' ? f.footprintMm.centerZ : 0;
  const e = f.elevationMm, h = f.heightMm, south = z + d / 2, north = z - d / 2;
  const add = (facade: Facade, originMm: Vec3, rotationY: number, widthMm: number, openings: Opening[], page: number) => walls.push({
    id: `${f.id}-${facade}`, floorId: f.id, facade, tileGridDatum: facade, originMm, rotationY, widthMm, heightMm: h, thicknessMm: f.id === 'f1' ? 200 : upperWallThicknessMm,
    evidence: evidence(page, '墙厚为演示假设；洞口采用独立局部坐标。'), openings,
    finishZones: [zone(0, 0, widthMm, h, f.id === 'f2' ? 'basalt' : 'ivory')],
  });
  const front = f.id === 'f1' ? [op('f1-s-window', 810, 400, 2800, 2400, 5), op('f1-porch', 4350, 0, 5500, 3300, 5, 'balcony')]
    : f.id !== 'f4' ? [op(`${f.id}-s-window`, 810, f.id === 'f2' ? 1000 : 600, 2800, f.id === 'f2' ? 1500 : 2200, 5), op(`${f.id}-balcony`, 4350, f.id === 'f2' ? 100 : 600, 5500, f.id === 'f2' ? 2700 : 2200, 5, 'balcony')]
    : [op('f4-s-window', 830, 2100, 2400, 700, 5), op('f4-s-door', 4660, 0, 900, 2700, 5, 'door'), op('f4-s-glass', 5860, 0, 4200, 2700, 5)];
  if (f.id === 'f4') {
    const leftWidth = terrace.partitionX + w / 2;
    add('front', [-w / 2 + upperWallThicknessMm, e, terrace.wallFront - terrace.recessDepth], 0, leftWidth - upperWallThicknessMm,
      front.filter(o => o.id !== 'f4-s-glass').map(o => ({ ...o, x: o.x - upperWallThicknessMm })), 5);
    const recessed = walls[walls.length - 1];
    recessed.surfaceKind = 'inner-wall'; delete recessed.tileGridDatum;
    recessed.evidence.note += ' 退台后墙起于西墙内皮，扣除260墙厚，洞口世界定位不变；不穿入西侧外墙。';
    walls.push({ id: 'f4-front-east', floorId: f.id, facade: 'front', originMm: [terrace.partitionX, e, terrace.wallFront], rotationY: 0,
      widthMm: w - leftWidth - reliefMm, heightMm: h, thicknessMm: upperWallThicknessMm, tileGridDatum: 'front', surfaceCuts: [{ x: 0, y: h - terrace.roofFasciaHeight, width: w - leftWidth, height: terrace.roofFasciaHeight }], openings: [op('f4-s-glass', terraceWindowLeftInsetMm, 0, 4200 - terraceWindowLeftInsetMm, 2700, 5)],
      evidence: evidence(5, '用户确认大窗仅左边内缩240mm，现为3960×2700、世界X940–4900；前墙东端接至东侧灰面X5100，形成完整包窗边墙。'), finishZones: [zone(0, 0, w - leftWidth - reliefMm, h, 'basalt', 0)] });
    walls.push({ id: 'f4-terrace-return', floorId: f.id, facade: 'front', originMm: [terrace.partitionX, e, terrace.wallFront - terrace.recessDepth], rotationY: -Math.PI / 2,
      widthMm: terrace.recessDepth, heightMm: h, thicknessMm: 200, surfaceKind: 'inner-wall', openings: [],
      evidence: evidence(4, '四层局部有顶凹口侧返墙，纵深2200按平面；厚度待复核。'), finishZones: [zone(0, 0, terrace.recessDepth, h, 'basalt', 0)] });
  } else add('front', [-w / 2, e, south], 0, w, front, 5);
  const back = f.id === 'f1' ? [op('f1-n-window', 5950, 1900, 2100, 700, 6)]
    : [op(`${f.id}-n-stair`, 3210, 1000, 800, 1500, 6), ...(f.id === 'f2' ? [op('f2-n-window', 5960, 1800, 2100, 700, 6)] : f.id === 'f4' ? [op('f4-n-window', 5960, 1000, 3900, 1500, 6)] : [])];
  add('back', [w / 2, e, north], Math.PI, w, back, 6);
  const west = f.id === 'f1' ? [op('f1-w-low', 1660, 1000, 800, 550, 7), ...[3360, 5460, 9410].map((x, i) => op(`f1-w-${i}`, x, 1000, 800, 1800, 7))]
    : f.id === 'f4' ? [op('f4-w-a', 460, 1000, 1400, 1500, 7), op('f4-w-b', 3360, 1000, 800, 1500, 7)]
    : [op(`${f.id}-w-stair`, 1060, 0, 800, 1200, 7), ...[3360, 5460, 7760].map((x, i) => op(`${f.id}-w-${i}`, x, 1000, 800, 1500, 7))];
  add('left', [-w / 2, e, north], -Math.PI / 2, d, west, 7);
  const east = f.id === 'f1' ? [op('f1-entry-screen-opening', entranceScreen.startMm, 0, entranceScreen.widthMm, entranceScreen.heightMm, 8, 'balcony'), op('f1-e-low', 3080, 1200, 4200, 700, 8), op('f1-e-window', 8300, 1000, 2400, 1800, 8)]
    : f.id === 'f4' ? [op('f4-e-window', 2650, 1000, 2400, 1500, 8)]
    : [op(`${f.id}-e-narrow`, 6130, 1000, 1200, 1500, 8), op(`${f.id}-e-window`, 8300, 1000, 2400, 1500, 8), ...(f.id === 'f2' ? [op('f2-e-balcony', 0, balconySide.y, balcony.depth, balconySide.height, 8, 'balcony')] : [])];
  const eastNarrow = east.find(o => o.id === `${f.id}-e-narrow`);
  if (eastNarrow) eastNarrow.evidence.note = '1200×1500按PDF；横向按效果图置于1340宽灰带内，两侧各70，定位待复核。';
  // References 185043 / 185036 show a solid grey strip on the top east side.
  add('right', [w / 2, e, south], Math.PI / 2, d, east, 8);
  if (f.id !== 'f4') {
    walls.push({
    id: `${f.id}-porch-back`, floorId: f.id, facade: 'front', originMm: [-w / 2 + balcony.x, e, south - balcony.depth], rotationY: 0, widthMm: balcony.width, heightMm: h, thicknessMm: balcony.thickness,
    evidence: evidence(1, '前廊/阳台退入1600据平面，后墙与两侧返墙独立建模。'),
    openings: f.id === 'f1' ? [op('entry-slot', 0, 1000, 600, 1800, 5), op('entry-door', 1350, 0, 1500, 2800, 5, 'door'), op('entry-side', 3350, 400, 2150, 2400, 5)] : [op(`${f.id}-balcony-slot`, 0, f.id === 'f2' ? 100 : 600, 600, f.id === 'f2' ? 2700 : 2200, 5), op(`${f.id}-balcony-door`, 2100, f.id === 'f2' ? 100 : 600, 3000, f.id === 'f2' ? 2700 : 2200, 5)],
    finishZones: [zone(0, 0, balcony.width, h, 'basalt', 0)],
  });
    for (const side of ['left', 'right'] as const) walls.push({
      id: `${f.id}-porch-${side}`, floorId: f.id, facade: 'front',
      originMm: side === 'left' ? [-w / 2 + balcony.x, e, south] : [-w / 2 + balcony.x + balcony.width, e, south - balcony.depth],
      rotationY: side === 'left' ? Math.PI / 2 : -Math.PI / 2, widthMm: balcony.depth, heightMm: h, thicknessMm: balcony.thickness,
      openings: f.id === 'f2' && side === 'right' ? [op('f2-porch-side-opening', 0, balconySide.y, balcony.depth, balconySide.height, 8, 'balcony')] : [],
      evidence: evidence(Number(f.id.slice(1)), f.id === 'f2' && side === 'right' ? '效果图二层东侧为玻璃栏杆敞口，与前阳台贯通；保留上下梁和前侧框柱。' : '前廊/阳台侧封闭墙：连接前洞口与后墙，纵深1600按平面，墙厚待核实。'),
      finishZones: [zone(0, 0, balcony.depth, h, f.id === 'f2' || f.id === 'f1' && side === 'right' ? 'basalt' : 'ivory', 0)],
    });
  }
}
// The second-floor grey corner edges meet the grey side planes, not the outer white datum.
for (const wall of walls.filter(w => w.floorId === 'f2')) {
  if (wall.id === 'f2-front') {
    wall.originMm[0] += reliefMm; wall.widthMm -= reliefMm * 2;
    wall.openings.forEach(o => { o.x -= reliefMm; });
  } else if (wall.id === 'f2-left') wall.widthMm -= reliefMm;
  else if (wall.id === 'f2-right') {
    wall.originMm[2] -= reliefMm; wall.widthMm -= reliefMm;
    wall.openings.forEach(o => {
      if (o.kind === 'balcony') { o.x = balcony.thickness; o.width -= reliefMm + balcony.thickness; }
      else o.x -= reliefMm;
    });
  } else if (wall.id === 'f2-porch-left') {
    wall.originMm[2] -= reliefMm; wall.widthMm -= reliefMm;
  } else if (wall.id === 'f2-porch-right') {
    wall.widthMm -= reliefMm; wall.openings.forEach(o => { o.width -= reliefMm + balcony.thickness; });
  }
  wall.finishZones.forEach(z => { z.width = wall.widthMm; });
  wall.evidence.note += ' 二层灰框实体边收至共同灰面，名义前廊1600扣60后净模型深1540；节点定位待核实。';
  if (wall.id === 'f2-right' || wall.id === 'f2-porch-right') wall.evidence.note += ' 侧敞口按用户确认的300mm角墙侧深收口，最终净口1240；角墙南面400。';
}
// Both storeys share the confirmed 400mm south face and 300mm side return.
// The side enclosure is open; the ground floor receives a screen instead of masonry.
for (const floorId of ['f1', 'f2']) {
  const front = walls.find(w => w.id === `${floorId}-front`)!, east = walls.find(w => w.id === `${floorId}-right`)!;
  const side = walls.find(w => w.id === `${floorId}-porch-right`)!, back = walls.find(w => w.id === `${floorId}-porch-back`)!;
  if (floorId === 'f1') {
    back.originMm[2] = east.originMm[2] - entranceScreen.startMm - entranceScreen.widthMm;
    const left = walls.find(w => w.id === 'f1-porch-left')!;
    left.widthMm = left.originMm[2] - back.originMm[2]; left.finishZones.forEach(z => { z.width = left.widthMm; });
    side.originMm[2] = back.originMm[2]; side.widthMm = east.originMm[2] - back.originMm[2];
    side.finishZones.forEach(z => { z.width = side.widthMm; });
  }
  const opening = front.openings.find(o => o.kind === 'balcony')!;
  opening.width = cornerInnerX - front.originMm[0] - opening.x;
  const sideOpening = east.openings.find(o => o.kind === 'balcony')!;
  sideOpening.x = east.originMm[2] - (cornerJamb.southMm - cornerJamb.sideDepthMm);
  sideOpening.width = cornerJamb.southMm - cornerJamb.sideDepthMm - back.originMm[2];
  side.originMm[0] = cornerInnerX; side.surfaceOnly = true;
  side.openings = [op(`${floorId}-porch-side-opening`, 0, floorId === 'f1' ? 0 : balconySide.y, sideOpening.width,
    floorId === 'f1' ? entranceScreen.heightMm : balconySide.height, 8, 'balcony')];
  if (floorId === 'f1') { back.widthMm = cornerJamb.eastMm - back.originMm[0]; back.finishZones.forEach(z => { z.width = back.widthMm; }); }
  side.evidence = evidence(0, '用户确认角墙截面：南面400mm、侧面300mm，一二层一致；右侧围护非实墙，一层为200mm厚透光格栅、二层为玻璃栏杆。', 'drawing');
}
// The ground-floor south-east jamb ends at the recessed south finish plane.
{
  const side = walls.find(w => w.id === 'f1-porch-right')!;
  side.widthMm -= reliefMm;
  side.finishZones.forEach(z => { z.width = side.widthMm; });
  walls.find(w => w.id === 'f2-porch-back')!.openings.find(o => o.id === 'f2-balcony-slot')!.evidence.note = '按用户画线，与旁边落地窗上下边对齐：下口100、上口2800，宽600；开启方式仍待核实。';
}
// Facade cladding covers slab edges; structural wall caps stop at the slab underside.
for (const wall of walls) {
  wall.topCoveredMm = terrace.floorThickness;
  if (wall.surfaceKind === 'inner-wall') wall.surfaceCuts = [{ x: 0, y: wall.heightMm - terrace.floorThickness, width: wall.widthMm, height: terrace.floorThickness }];
}
// The new 240mm left jamb encloses the window. The return meets its back,
// while the jamb's exposed west side completes the finish to the outer edge.
{
  const front = walls.find(w => w.id === 'f4-front-east')!, side = walls.find(w => w.id === 'f4-terrace-return')!;
  side.surfaceCuts!.push({ x: side.widthMm - front.thicknessMm, y: 0, width: front.thicknessMm, height: side.heightMm });
  side.evidence.note += ' 返墙实体止于包窗边墙背面；外露端面由边墙实体生成，窗左保留240mm完整边墙。';
}
// Colour zones and their physical offsets share one configuration. No texture scaling is used for relief.
for (const wall of walls.filter(w => /^f[1-4]-(front|back|left|right)$/.test(w.id))) {
  const f = floors.find(f => f.id === wall.floorId)!, w = wall.widthMm, h = wall.heightMm;
  const base = wall.facade === 'back' ? (f.id === 'f1' ? 'basalt' : 'ivory') : f.id === 'f1' && wall.facade !== 'front' || f.id === 'f2' || f.id === 'f4' && wall.facade === 'front' ? 'basalt' : 'ivory';
  wall.finishZones = [zone(0, 0, w, h, base, f.id === 'f4' && wall.facade === 'front' ? 0 : undefined)];
  const overlay = (rect: FinishZone) => {
    const clipped = intersect(rect, { x: 0, y: 0, width: w, height: h });
    if (!clipped) return;
    wall.finishZones = wall.finishZones.flatMap(z => clipHoles(z, [clipped]).map(r => ({ ...z, ...r }))).concat({ ...rect, ...clipped });
  };
  if (f.id === 'f1') {
    if (wall.facade === 'front') overlay({ ...zone(cornerInnerX - wall.originMm[0], 0, w - (cornerInnerX - wall.originMm[0]), h - groundRingBeamHeightMm, 'basalt'),
      backMm: cornerJamb.southMm - cornerJamb.sideDepthMm - wall.originMm[2] });
    if (wall.facade === 'right') wall.surfaceCuts = [{ x: 0, y: 0, width: reliefMm, height: h - groundRingBeamHeightMm }];
    if (wall.facade === 'left') overlay(zone(w - 2100, 0, 2100, h, 'ivory'));
    overlay(zone(0, h - groundRingBeamHeightMm, w, groundRingBeamHeightMm, 'ivory'));
    if (wall.facade === 'right') overlay({ ...zone(reliefMm, h - groundRingBeamHeightMm, entranceScreen.startMm + entranceScreen.widthMm - reliefMm, groundRingBeamHeightMm, 'ivory'),
      backMm: cornerInnerX - wall.originMm[0] });
    if (wall.facade === 'back') wall.surfaceCuts = [{ x: w - reliefMm, y: 0, width: reliefMm, height: h - groundRingBeamHeightMm }];
    if (wall.facade === 'left') wall.surfaceCuts = [{ x: 0, y: 0, width: reliefMm, height: h - groundRingBeamHeightMm }];
  } else if (wall.facade === 'back') {
    if (f.id === 'f2') overlay({ ...zone(3210, 2500, 800, h - 2500, 'basalt'), faceKey: 'north-stair-upper' });
    else overlay(zone(3210, 0, 800, h - (f.id === 'f4' ? 800 : 0), 'basalt'));
    if (f.id === 'f4') {
      overlay(zone(5960, 1000, w - 5960, 1500, 'basalt'));
      wall.surfaceCuts = [{ x: w - reliefMm, y: 1000, width: reliefMm, height: 1500 }];
    }
  } else if (wall.facade === 'left') {
    if (f.id === 'f2') overlay(zone(0, 0, 2960, h, 'ivory'));
    else overlay(zone(2960, 0, f.id === 'f4' ? w - 2960 : 1800, h, 'basalt'));
    if (f.id !== 'f4') overlay({ ...zone(1060, 0, 800, 1800, 'basalt'), faceKey: 'west-stair-cap' });
    if (f.id === 'f4') {
      overlay(zone(0, 1000, 1860, 1500, 'basalt'));
      // Lower white terrace wall ends on the third-floor grey band's edge.
      overlay(zone(2960 + 1800, 0, w - 2960 - 1800, terrace.parapetHeight, 'ivory'));
      wall.surfaceCuts = [{ x: 0, y: 1000, width: reliefMm, height: 1500 }];
    }
    if (f.id === 'f4') overlay(zone(0, h - 500, w, 500, 'ivory'));
  } else if (wall.facade === 'right') {
    if (f.id === 'f2') overlay(zone(7400 - reliefMm, 0, w - (7400 - reliefMm), h, 'ivory'));
    else overlay(zone(f.id === 'f4' ? 0 : 6060, 0, f.id === 'f4' ? 1780 : 1340, h, 'basalt'));
    if (f.id === 'f4') overlay(zone(0, 0, terrace.wallFront - (facadeEnvelope.depth / 2 - 6060), terrace.parapetHeight, 'ivory'));
    if (f.id === 'f4') overlay(zone(0, h - 500, w, 500, 'ivory'));
  }
  if (f.id === 'f2' && wall.facade === 'front') overlay({ ...zone(cornerInnerX - wall.originMm[0], 0, cornerJamb.frontWidthMm, h, 'basalt'),
    backMm: cornerJamb.southMm - cornerJamb.sideDepthMm - wall.originMm[2] });
  wall.evidence.note += ' 配色分区参照对应立面与效果图，浅深交界为60mm实体错位；未标注的色带起点待复核。';
  if (f.id === 'f4' && (wall.facade === 'back' || wall.facade === 'left')) wall.evidence.note += ' 后西灰L按截图及185054对应顶层窗高带定位；用户文字称三层但截图大窗属于四层，暂按截图建模，边界待核实。';
}
// Slab edges sit behind both finish planes; the facade zones continue across the floor beams.
const parts: Part[] = floors.map(f => ({ id: `${f.id}-slab`, floorId: f.id, kind: 'slab', centerMm: [0, (f.id === 'f1' ? entrance.groundMm : f.elevationMm) - terrace.floorThickness / 2, 0], sizeMm: [facadeEnvelope.width + (f.id === 'f1' ? baseProjectionMm : -structureInsetMm) * 2, terrace.floorThickness, facadeEnvelope.depth + (f.id === 'f1' ? baseProjectionMm : -structureInsetMm) * 2], color: '#c2c2b8' }));
parts.push(
  { id: 'roof-slab', floorId: 'f4', kind: 'slab', centerMm: [0, terrace.roofElevation - terrace.floorThickness / 2, (terrace.north + terrace.roofFront) / 2], sizeMm: [10320, terrace.floorThickness, terrace.roofFront - terrace.north], color: '#c2c2b8' },
  { id: 'roof-fascia', floorId: 'f4', kind: 'parapet', centerMm: [0, terrace.roofElevation - terrace.roofFasciaHeight / 2, (terrace.roofFront + terrace.wallFront - upperWallThicknessMm) / 2], sizeMm: [10320, terrace.roofFasciaHeight, terrace.roofFront - terrace.wallFront + upperWallThicknessMm], color: '#e7e5dc' },
  { id: 'terrace-south', floorId: 'f4', kind: 'parapet', centerMm: [0, floors[3].elevationMm + terrace.parapetHeight / 2, terrace.south - terrace.parapetThickness / 2], sizeMm: [10320, terrace.parapetHeight, terrace.parapetThickness], color: '#e7e5dc' },
  { id: 'roof-front', floorId: 'f4', kind: 'parapet', centerMm: [0, 14000, terrace.roofFront - terrace.parapetThickness / 2], sizeMm: [10320, 600, 160], color: '#e7e5dc' },
  { id: 'roof-back', floorId: 'f4', kind: 'parapet', centerMm: [0, 14000, -6080], sizeMm: [10320, 600, 160], color: '#e7e5dc' },
  { id: 'entry-plinth', floorId: 'f1', kind: 'slab', centerMm: [0, entrance.groundMm / 2, 0], sizeMm: [facadeEnvelope.width, -entrance.groundMm, facadeEnvelope.depth], color: '#aeb1a9' },
  { id: 'entry-platform', floorId: 'f1', kind: 'step', centerMm: [0, entrance.groundMm / 2, facadeEnvelope.depth / 2 + entrance.platformDepthMm / 2], sizeMm: [facadeEnvelope.width, -entrance.groundMm, entrance.platformDepthMm], color: '#aeb1a9' },
);
for (let i = 1; i < entrance.risers; i++) {
  const height = -entrance.groundMm - i * entrance.riseMm;
  parts.push({ id: i === 1 ? 'front-step' : `entry-step-${i}`, floorId: 'f1', kind: 'step',
    centerMm: [entrance.stairCenterX, entrance.groundMm + height / 2, facadeEnvelope.depth / 2 + entrance.platformDepthMm + (i - 0.5) * entrance.treadMm],
    sizeMm: [entrance.stairWidthMm, height, entrance.treadMm], color: '#aeb1a9' });
}
for (const sign of [-1, 1]) parts.push(
  { id: `terrace-side-${sign}`, floorId: 'f4', kind: 'parapet', centerMm: [sign * 5080, floors[3].elevationMm + terrace.parapetHeight / 2, (terrace.wallFront + terrace.south) / 2], sizeMm: [160, terrace.parapetHeight, terrace.south - terrace.wallFront], color: '#e7e5dc' },
  { id: `roof-side-${sign}`, floorId: 'f4', kind: 'parapet', centerMm: [sign * 5080, 14000, (terrace.north + terrace.roofFront) / 2], sizeMm: [160, 600, terrace.roofFront - terrace.north], color: '#e7e5dc' },
);
for (const f of floors.slice(1, 3)) parts.push({ id: `${f.id}-rail`, floorId: f.id, kind: 'rail', centerMm: [-facadeEnvelope.width / 2 + balcony.x + balcony.width / 2, f.elevationMm + balconySide.railBase + balconySide.railHeight / 2, facadeEnvelope.depth / 2 - balconySide.railFrontInset - (f.id === 'f2' ? reliefMm : 0)], sizeMm: [balcony.width, balconySide.railHeight, balconySide.railThickness], color: '#8babad' });
{
  const rail = parts.find(p => p.id === 'f2-rail')!;
  rail.sizeMm[0] = cornerInnerX - (-facadeEnvelope.width / 2 + balcony.x);
  rail.centerMm[0] = cornerInnerX - rail.sizeMm[0] / 2;
}
parts.push({ id: 'f2-side-rail', floorId: 'f2', kind: 'rail', centerMm: [facadeEnvelope.width / 2 - reliefMm - balconySide.railThickness / 2, floors[1].elevationMm + balconySide.railBase + balconySide.railHeight / 2,
  (cornerJamb.southMm - cornerJamb.sideDepthMm + facadeEnvelope.depth / 2 - balcony.depth) / 2], sizeMm: [balconySide.railThickness, balconySide.railHeight, cornerJamb.southMm - cornerJamb.sideDepthMm - (facadeEnvelope.depth / 2 - balcony.depth)], color: '#8babad' });
parts.push({ id: 'f1-entry-screen', floorId: 'f1', kind: 'screen', centerMm: [facadeEnvelope.width / 2 - reliefMm - entranceScreen.depthMm / 2,
  entranceScreen.heightMm / 2, facadeEnvelope.depth / 2 - entranceScreen.startMm - entranceScreen.widthMm / 2],
  sizeMm: [entranceScreen.depthMm, entranceScreen.heightMm, entranceScreen.widthMm], color: entranceScreen.color,
  screen: { slatWidthMm: entranceScreen.slatWidthMm, gapMm: entranceScreen.gapMm, frameWidthMm: entranceScreen.frameWidthMm } });

// Parapet outer faces use the same millimetre layout pipeline as facade walls.
const solidParts = parts.filter(p => p.kind !== 'parapet');
for (const p of parts.filter(p => p.kind === 'parapet')) {
  const [x, y, z] = p.centerMm, [w, h, d] = p.sizeMm;
  const facade: Facade = w > d ? (z > 0 ? 'front' : 'back') : (x > 0 ? 'right' : 'left');
  const originMm: Vec3 = facade === 'front' ? [x - w / 2, y - h / 2, z + d / 2]
    : facade === 'back' ? [x + w / 2, y - h / 2, z - d / 2]
    : facade === 'right' ? [x + w / 2, y - h / 2, z + d / 2] : [x - w / 2, y - h / 2, z - d / 2];
  const widthMm = w > d ? w : d;
  walls.push({ id: p.id, floorId: p.floorId, facade, tileGridDatum: facade, originMm,
    rotationY: { front: 0, back: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 }[facade],
    widthMm, heightMm: h, thicknessMm: Math.min(w, d), openings: [],
    evidence: evidence(5, '屋顶女儿墙600、露台栏墙1200按立面；厚度及连接节点待复核。'),
    finishZones: [zone(0, 0, widthMm, h, 'ivory')],
  });
}

const addSurface = (id: string, floorId: string, surfaceKind: 'outdoor-floor' | 'inner-wall', facade: Facade, originMm: Vec3, rotationY: number, widthMm: number, heightMm: number, page: number, rotationX = 0) => walls.push({
  id, floorId, facade, originMm, rotationY, rotationX, widthMm, heightMm, thicknessMm: 1, surfaceOnly: true, surfaceKind, openings: [],
  evidence: evidence(page, '独立装修表面沿既有结构边线铺贴，不增加实体；节点厚度及边界定位待核实。'),
  finishZones: [zone(0, 0, widthMm, heightMm, surfaceKind === 'outdoor-floor' ? 'concrete' : 'ivory', 0)],
});
for (const f of floors.slice(0, 3)) {
  const back = walls.find(w => w.id === `${f.id}-porch-back`)!, side = walls.find(w => w.id === `${f.id}-porch-left`)!;
  addSurface(`${f.id}-porch-floor`, f.id, 'outdoor-floor', 'front', [back.originMm[0], f.elevationMm, side.originMm[2]], 0,
    f.id === 'f1' ? cornerJamb.eastMm - entranceScreen.depthMm - back.originMm[0] : f.id === 'f2' ? cornerInnerX - back.originMm[0] : balcony.width, side.widthMm, Number(f.id.slice(1)), -Math.PI / 2);
}
// The open second-floor side reaches the real east wall, not a second wall
// at the front opening edge. The exposed jamb is finish-only on the front wall.
{
  const east = walls.find(w => w.id === 'f2-right')!, back = walls.find(w => w.id === 'f2-porch-back')!;
  const jamb = walls.find(w => w.id === 'f2-porch-right')!, opening = east.openings.find(o => o.kind === 'balcony')!;
  const innerX = east.originMm[0] - east.thicknessMm, outerX = east.originMm[0] + east.finishZones.find(z => z.materialId === 'basalt')!.offsetMm;
  const openingFront = east.originMm[2] - opening.x, openingBack = openingFront - opening.width;
  back.widthMm = outerX - back.originMm[0]; back.finishZones.forEach(z => { z.width = back.widthMm; });
  const edgeX = innerX - back.originMm[0], edgeWidth = outerX - innerX;
  back.surfaceCuts = [{ x: edgeX, y: 0, width: edgeWidth, height: opening.y },
    { x: edgeX, y: opening.y + opening.height, width: edgeWidth, height: back.heightMm - opening.y - opening.height }];
  jamb.surfaceOnly = true;
  jamb.surfaceCuts = [{ x: 0, y: 0, width: jamb.widthMm, height: opening.y },
    { x: 0, y: opening.y + opening.height, width: jamb.widthMm, height: jamb.heightMm - opening.y - opening.height }];
  back.evidence.note += ' 二层侧敞口后墙延至东墙内皮，洞口高度内接至外皮形成完整侧洞口返面；不再留210mm模型缺口。';
  jamb.evidence.note += ' 仅保留前墙洞口内侧装修面，不另叠加柱体。';
  addSurface('f2-balcony-right-inner', 'f2', 'inner-wall', 'right', [innerX, floors[1].elevationMm, openingBack], -Math.PI / 2,
    opening.width, floors[1].heightMm - terrace.floorThickness, 2);
  const inner = walls[walls.length - 1];
  inner.openings = [op('f2-balcony-inner-opening', 0, opening.y, opening.width, opening.height, 8, 'balcony')];
  inner.finishZones = [zone(0, 0, inner.widthMm, inner.heightMm, 'basalt', 0)];
  inner.finishSourceFaceId = 'f2-porch-right:face:0'; inner.finishSourcePointMm = [jamb.widthMm - balcony.thickness / 2, opening.y + opening.height / 2];
  addSurface('f2-porch-floor-side', 'f2', 'outdoor-floor', 'front', [jamb.originMm[0], floors[1].elevationMm, openingFront], 0,
    innerX - jamb.originMm[0], opening.width, 2, -Math.PI / 2);
  const floorSide = walls[walls.length - 1];
  floorSide.finishSourceFaceId = 'f2-porch-floor:face:0'; floorSide.finishSourcePointMm = [balcony.width / 2, jamb.widthMm / 2];
}
// Third-floor balcony: the side finish follows the east wall's inner skin.
// Only the front jamb returns to the opening edge, leaving a genuine L recess.
{
  const east = walls.find(w => w.id === 'f3-right')!, front = walls.find(w => w.id === 'f3-front')!;
  const back = walls.find(w => w.id === 'f3-porch-back')!, side = walls.find(w => w.id === 'f3-porch-right')!;
  const innerX = east.originMm[0] - east.thicknessMm, openingEdgeX = side.originMm[0];
  side.originMm[0] = innerX; side.widthMm = balcony.depth - front.thicknessMm; side.surfaceOnly = true;
  side.surfaceCuts = [{ x: 0, y: side.heightMm - terrace.floorThickness, width: side.widthMm, height: terrace.floorThickness }];
  side.finishZones = [zone(0, 0, side.widthMm, side.heightMm, 'ivory', 0)];
  back.widthMm = innerX - back.originMm[0]; back.finishZones.forEach(z => { z.width = back.widthMm; });
  addSurface('f3-balcony-front-inner', 'f3', 'inner-wall', 'front', [innerX, floors[2].elevationMm, front.originMm[2] - front.thicknessMm], Math.PI,
    innerX - back.originMm[0], front.heightMm - terrace.floorThickness, 3);
  const inner = walls[walls.length - 1], opening = front.openings.find(o => o.kind === 'balcony')!;
  inner.openings = [op('f3-balcony-inner-opening', innerX - openingEdgeX, opening.y, opening.width, opening.height, 5, 'balcony')];
  addSurface('f3-balcony-front-jamb', 'f3', 'inner-wall', 'front', [openingEdgeX, floors[2].elevationMm + opening.y, front.originMm[2] - front.thicknessMm], -Math.PI / 2,
    front.thicknessMm, opening.height, 3);
  addSurface('f3-porch-floor-side', 'f3', 'outdoor-floor', 'front', [openingEdgeX, floors[2].elevationMm, front.originMm[2] - front.thicknessMm], 0,
    innerX - openingEdgeX, side.widthMm, 3, -Math.PI / 2);
  walls[walls.length - 1].finishSourceFaceId = 'f3-porch-floor:face:0'; walls[walls.length - 1].finishSourcePointMm = [balcony.width / 2, balcony.depth / 2];
  const left = walls.find(w => w.id === 'f3-porch-left')!;
  const adjacentWindow = back.openings.find(o => o.id === 'f3-balcony-door')!;
  left.openings.push({ ...op('f3-balcony-side-door', 350, 0, 900, adjacentWindow.y + adjacentWindow.height, 3, 'door'),
    evidence: evidence(3, '用户确认三层侧门上沿与同层相邻窗上沿对齐，门从楼面起高2800mm；宽900与沿墙定位仍为演示暂定，未标施工尺寸待复核。') });
  side.evidence.note += ' 三层内侧收至东墙内皮，前洞口侧边单独返接，取消双墙叠厚。';
}
const innerHalfWidth = facadeEnvelope.width / 2 - terrace.parapetThickness;
// Visible balcony floors stop at the inside of the solid sill, not under it.
for (const floorId of ['f2', 'f3']) {
  const floor = walls.find(w => w.id === `${floorId}-porch-floor`)!, front = walls.find(w => w.id === `${floorId}-front`)!;
  const offset = front.finishZones[0].offsetMm;
  floor.surfaceCuts = [{ x: 0, y: 0, width: floor.widthMm, height: front.thicknessMm + offset }];
}
{
  const front = walls.find(w => w.id === 'f2-front')!, back = walls.find(w => w.id === 'f2-porch-back')!;
  const innerX = walls.find(w => w.id === 'f2-balcony-right-inner')!.originMm[0], opening = front.openings.find(o => o.kind === 'balcony')!;
  addSurface('f2-balcony-front-inner', 'f2', 'inner-wall', 'front', [innerX, floors[1].elevationMm, front.originMm[2] - front.thicknessMm], Math.PI,
    innerX - back.originMm[0], front.heightMm - terrace.floorThickness, 2);
  const inner = walls[walls.length - 1];
  inner.openings = [op('f2-balcony-front-inner-opening', innerX - (front.originMm[0] + opening.x + opening.width), opening.y, opening.width, opening.height, 5, 'balcony')];
  inner.finishZones = [zone(0, 0, inner.widthMm, inner.heightMm, 'basalt', 0)];
}
const innerSouth = terrace.south - terrace.parapetThickness;
addSurface('f4-terrace-floor', 'f4', 'outdoor-floor', 'front', [-innerHalfWidth, floors[3].elevationMm, innerSouth], 0, innerHalfWidth * 2, innerSouth - terrace.wallFront, 4, -Math.PI / 2);
addSurface('f4-covered-terrace-floor', 'f4', 'outdoor-floor', 'front', [-facadeEnvelope.width / 2 + walls.find(w => w.id === 'f4-left')!.thicknessMm, floors[3].elevationMm, terrace.wallFront], 0, terrace.partitionX + facadeEnvelope.width / 2 - walls.find(w => w.id === 'f4-left')!.thicknessMm, terrace.recessDepth, 4, -Math.PI / 2);
addSurface('f4-covered-left-inner', 'f4', 'inner-wall', 'left', [-facadeEnvelope.width / 2 + upperWallThicknessMm, floors[3].elevationMm, terrace.wallFront], Math.PI / 2,
  terrace.recessDepth, floors[3].heightMm - terrace.floorThickness, 4);
{
  const inner = walls[walls.length - 1], fasciaBottom = floors[3].heightMm - terrace.roofFasciaHeight;
  inner.finishZones.forEach(z => { z.materialId = 'basalt'; });
  inner.surfaceCuts = [{ x: 0, y: fasciaBottom, width: upperWallThicknessMm, height: inner.heightMm - fasciaBottom }];
}
addSurface('f4-roof-floor', 'f4', 'outdoor-floor', 'front', [-innerHalfWidth, terrace.roofElevation, terrace.roofFront - terrace.parapetThickness], 0, innerHalfWidth * 2, terrace.roofFront - terrace.north - terrace.parapetThickness * 2, 4, -Math.PI / 2);
for (const p of parts.filter(p => p.kind === 'parapet' && p.id !== 'roof-fascia')) {
  const [x, y, z] = p.centerMm, [w, h, d] = p.sizeMm, t = terrace.parapetThickness;
  if (w > d) {
    const front = p.id !== 'roof-back';
    addSurface(`${p.id}-inner`, p.floorId, 'inner-wall', front ? 'back' : 'front', [front ? x + w / 2 - t : x - w / 2 + t, y - h / 2, front ? z - d / 2 : z + d / 2], front ? Math.PI : 0, w - t * 2, h, 5);
  } else {
    const right = x > 0, north = z - d / 2 + (p.id.startsWith('roof-') ? t : 0), south = z + d / 2 - t;
    addSurface(`${p.id}-inner`, p.floorId, 'inner-wall', right ? 'left' : 'right', [right ? x - w / 2 : x + w / 2, y - h / 2, right ? north : south], right ? -Math.PI / 2 : Math.PI / 2, south - north, h, 5);
  }
}

// Terrace and roof visibility is independent of the fourth-floor room.
// The front lintel completes the fourth-floor enclosure, even with the roof hidden.
for (const wall of walls) if (wall.id !== 'roof-fascia' && (/^(roof-|terrace-)/.test(wall.id) || ['f4-terrace-floor', 'f4-roof-floor'].includes(wall.id))) wall.viewGroup = 'terrace';
for (const part of solidParts) if (part.id === 'roof-slab') part.viewGroup = 'terrace';
walls.push(...reliefReturns(walls, tileDepthMm, reliefMm));

// Preserve the ring beam's horizontal returns while trimming the vertical
// corner strips to the adjoining recessed wall plane; no extra column body.
for (const [id, edge] of [['f1-front', 'end'], ['f1-right', 'end'], ['f1-back', 'start']] as const) {
  const wall = walls.find(w => w.id === id)!;
  wall.surfaceCuts = [...(wall.surfaceCuts ?? []), { x: edge === 'start' ? 0 : wall.widthMm - reliefMm,
    y: 0, width: reliefMm, height: floors[0].heightMm - groundRingBeamHeightMm }];
}

const outdoorMasks = Object.fromEntries(floors.map(f => [f.id, walls.filter(w => w.floorId === f.id && w.surfaceKind === 'outdoor-floor' && w.rotationX === -Math.PI / 2)
  .map(w => ({ x: w.originMm[0], y: w.originMm[2] - w.heightMm, width: w.widthMm, height: w.heightMm }))]));
const footprint = { x: -facadeEnvelope.width / 2, y: -facadeEnvelope.depth / 2, width: facadeEnvelope.width, height: facadeEnvelope.depth };
const baseTop = clipHoles({ x: footprint.x - baseProjectionMm, y: footprint.y - baseProjectionMm, width: footprint.width + baseProjectionMm * 2, height: footprint.height + baseProjectionMm * 2 }, [footprint]);
const exterior = exteriorSurfaces(walls, solidParts, entrance.groundMm, {
  'f1-slab': { top: baseTop, bottom: [] }, 'entry-plinth': { top: [], bottom: [] },
  ...Object.fromEntries(floors.slice(1).map((f, i) => [`${f.id}-slab`, { top: outdoorMasks[f.id], bottom: outdoorMasks[floors[i].id] }])),
  'roof-slab': { top: outdoorMasks.f4, bottom: outdoorMasks.f4 },
});
for (const surface of exterior) {
  if (/^exposed-(roof-(front|back|side-.*)|terrace-.*)-top-/.test(surface.id)) {
    surface.finishZones.forEach(z => { z.materialId = 'basalt'; });
    delete surface.finishSourceFaceId; delete surface.finishSourcePointMm;
  }
  const ceiling = surface.id.match(/^exposed-f([234])-slab-bottom-/);
  if (ceiling || surface.id.startsWith('exposed-roof-slab-bottom-')) {
    if (ceiling) surface.floorId = `f${Number(ceiling[1]) - 1}`;
    surface.finishZones.forEach(z => { z.materialId = 'paint'; });
  }
}
walls.push(...exterior);
const entranceNote = 'PDF第5–8页标注室内外高差450mm；三级踏步等分150mm为据图示推算。入户平台正面通长、外伸900mm以及阶宽1800、踏面300仍为效果展示参数，PDF未给完整节点尺寸。三楼阳台侧门按用户要求与旁窗上沿对齐，高2800；宽900与沿墙定位未标部分待复核。';

export const buildingConfig: BuildingConfig = {
  id: 'pdf-residence-1', name: '四层退台住宅', schemaVersion: 1, unit: 'mm', source: '合并终稿.pdf · 8页建筑图',
  notes: [entranceNote, '2.2角墙按用户结合PDF确认，一二层南面400、侧面300；格栅厚度按用户最新确认200。侧围护真实挖空，杆宽40、框宽40、目标净距80后均分仍为未标注演示参数；格栅颜色可独立保存。格栅净长按PDF第8页1200，后墙及地面同步沿既定角墙背面推算收口至Z4600；一层左返墙1560、右侧围护1500是当前完成面定位的推导值，平面1600名义尺寸保留，不声称1560为直接标注。全楼完成面扣除邻接实体遮挡，实体独立保留；楼层缝上下独立选面。', '楼层footprint保留PDF各平面原标注；装修墙面按立面10320×12320共同外缘统一，原标注差异待复核。浅色框与深色主体错位60；楼上板内收60，一层基板按用户展示要求以建筑外缘四周各外扩1000，尺寸12320×14320，非PDF施工标注。', '一层顶500白梁按用户标注四面环绕，下部四角收至邻接墙面，去掉额外竖向凸条；二层深灰前墙不额外添加浅带，北面同浅色连贯；西侧楼梯窄窗上800×600灰帽独立选材。层缝按用户要求统一20mm，包含屋顶女儿墙底线；二层北窗下为白面齐平，窗上独立灰块按最新批注凹60。', '后西灰L暂按截图及185054对应四层大窗的1000–2500高度带，凹60并裁去交角突出边；用户文字称三层而截图/图纸窗型属于四层，楼层及未标边界待核实，三层未据此新增灰L。', '阳台名义纵深1600；二层扣60错位后模型深1540，侧敞口按300深角墙收口后净口1240，栏杆沿东侧外缘；后墙补齐210缺口，边墙不另叠柱体。二、三层地面扣除前侧栏墙覆盖区后均为7.6514平方米，原面ID保留；墙厚/节点待核实。一层东侧门廊改真实开孔竖向透光格栅；东南边墙南面内缩60并改灰，与二层对齐。四层西段退入2200、屋檐前缘出挑60；大窗仅左边内缩240后为3960×2700、X940–4900；前墙接至东灰面，灰带在两侧转至凹口。二、三层阳台后墙补600宽窗，二层600宽小窗按画线改为窗台100、窗高2700，与旁边落地窗上下对齐；三层仍为600/2200。顶层东西灰带在栏墙顶1200高处转折，下段白墙边与三层灰带边线对齐。', '已建模的外露顶面、底面、板边、阳台内侧及屋顶/露台栏墙压顶可独立选材；压顶默认深灰，阳台顶板默认白漆。只计外露表面，不计埋入邻接实体及门窗框背后的面，不是施工清单。内置单价为演示估算。'],
  // Entrance detail follows the reference; its unlabelled dimensions are provisional.
  viewGroups: [{ id: 'terrace', label: '露台 / 屋顶', floorId: 'f4' }],
  floors, walls, parts: solidParts,
  materials: [{ id: 'ivory', name: '米白细石', color: '#e7e5dc', texture: 'stone', pricePerM2: 120 }, { id: 'basalt', name: '深灰岩板', color: '#494e50', texture: 'stone', pricePerM2: 180 }, { id: 'concrete', name: '浅灰水泥', color: '#a6aaa5', texture: 'concrete', pricePerM2: 80 }, { id: 'sand', name: '暖砂陶砖', color: '#b7a48c', texture: 'plain', pricePerM2: 100 }, { id: 'paint', name: '外墙漆', color: '#e7e5dc', texture: 'plain', kind: 'paint', pricePerM2: 35 }],
  defaultTile: { widthMm: 600, heightMm: 1200, direction: 'horizontal', groutMm: 3, groutColor: '#777b77', alignment: 'edge' },
  structureColor: '#c4c4b9',
  tileDatums: {
    front: { originMm: [-facadeEnvelope.width / 2, 0, facadeEnvelope.depth / 2], widthMm: facadeEnvelope.width, heightMm: terrace.roofElevation + 600 },
    back: { originMm: [facadeEnvelope.width / 2, 0, -facadeEnvelope.depth / 2], widthMm: facadeEnvelope.width, heightMm: terrace.roofElevation + 600 },
    left: { originMm: [-facadeEnvelope.width / 2, 0, -facadeEnvelope.depth / 2], widthMm: facadeEnvelope.depth, heightMm: terrace.roofElevation + 600 },
    right: { originMm: [facadeEnvelope.width / 2, 0, facadeEnvelope.depth / 2], widthMm: facadeEnvelope.depth, heightMm: terrace.roofElevation + 600 },
  },
  openings: { doorColor: '#4b5555', frameMm: 55, depthMm: openingDepthMm, frameColor: '#333d3f', glassColor: '#718f99', glassOpacity: 0.8, mullions: 2 },
  scene: { targetMm: [0, 6500, 0], cameraMm: [22000, 19500, 32000], groundSizeMm: 50000, explosionMm: 1800, tileDepthMm, maxCellsPerWall: 30000, maxMaterials: 32, maxTotalCells: 250000, floorJointMm: 20 },
};
