import type { Step } from './flowModel';

export const stepWidth = 156;
export const stepHeight = 54;
export const minStepWidth = 80;
export const stepFontFamily = '"Malgun Gothic", "Segoe UI", sans-serif';
export const titleFont = `600 14px ${stepFontFamily}`;
export const titleLineHeight = 20;
const context = document.createElement('canvas').getContext('2d')!;

export function stepLayout(step: Pick<Step, 'title' | 'width' | 'height'>) {
  const width = Math.max(minStepWidth, step.width ?? stepWidth);
  context.font = titleFont;
  const lines: string[] = [];
  for (const paragraph of (step.title.trim() ? step.title : '제목 없는 단계').split(/\r\n?|\n/u)) {
    let line = '';
    for (const character of paragraph) {
      if (line && context.measureText(line + character).width > width - 27) {
        lines.push(line);
        line = '';
      }
      line += character;
    }
    lines.push(line);
  }
  const minHeight = Math.max(stepHeight, 34 + lines.length * titleLineHeight);
  return { width, height: Math.max(step.height ?? stepHeight, minHeight), minHeight, lines };
}
