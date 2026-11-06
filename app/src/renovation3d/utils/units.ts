import type { Vec3 } from '../types';
export const m = (mm: number) => mm / 1000;
export const metres = (v: Vec3): Vec3 => [m(v[0]), m(v[1]), m(v[2])];
export const facadeLabels = { front: '前 · 南立面', back: '后 · 北立面', left: '左 · 西立面', right: '右 · 东立面' };
