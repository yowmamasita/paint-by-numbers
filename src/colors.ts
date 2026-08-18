import { hexToLab, hexToRgb, type Lab, type Rgb } from './color';

export interface PaletteColor {
  name: string;
  hex: string;
}

export interface PreparedColor extends PaletteColor {
  rgb: Rgb;
  lab: Lab;
}

/**
 * The standard Crayola 24-count box, with the official hex values.
 *
 * The previous list used eyeballed approximations (Green as #009900, Yellow as
 * #ffff00, Blue as #0066cc) which are far more saturated than the actual
 * crayons. That made the on-screen preview a poor predictor of what the printed
 * sheet would look like once coloured in.
 */
export const CRAYOLA_24: PaletteColor[] = [
  { name: 'Red', hex: '#EE204D' },
  { name: 'Scarlet', hex: '#FC2847' },
  { name: 'Red Orange', hex: '#FF5349' },
  { name: 'Orange', hex: '#FF7538' },
  { name: 'Yellow Orange', hex: '#FFAE42' },
  { name: 'Apricot', hex: '#FDD9B5' },
  { name: 'Dandelion', hex: '#FDDB6D' },
  { name: 'Yellow', hex: '#FCE883' },
  { name: 'Green Yellow', hex: '#F0E891' },
  { name: 'Yellow Green', hex: '#C5E384' },
  { name: 'Green', hex: '#1CAC78' },
  { name: 'Blue Green', hex: '#199EBD' },
  { name: 'Cerulean', hex: '#1DACD6' },
  { name: 'Blue', hex: '#1F75FE' },
  { name: 'Indigo', hex: '#5D76CB' },
  { name: 'Blue Violet', hex: '#7366BD' },
  { name: 'Violet', hex: '#926EAE' },
  { name: 'Red Violet', hex: '#C0448F' },
  { name: 'Violet Red', hex: '#F75394' },
  { name: 'Carnation Pink', hex: '#FFAACC' },
  { name: 'Brown', hex: '#B4674D' },
  { name: 'Gray', hex: '#95918C' },
  { name: 'Black', hex: '#232323' },
  { name: 'White', hex: '#FFFFFF' },
];

/** A punchier set for people who are painting rather than crayoning. */
export const VIVID_24: PaletteColor[] = [
  { name: 'Red', hex: '#E11D2E' },
  { name: 'Crimson', hex: '#B01030' },
  { name: 'Coral', hex: '#FF6F5E' },
  { name: 'Orange', hex: '#F97316' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Peach', hex: '#FFCBA4' },
  { name: 'Gold', hex: '#EAB308' },
  { name: 'Yellow', hex: '#FDE047' },
  { name: 'Lime', hex: '#A3E635' },
  { name: 'Leaf Green', hex: '#4D9C2F' },
  { name: 'Green', hex: '#16A34A' },
  { name: 'Forest', hex: '#14532D' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Sky', hex: '#38BDF8' },
  { name: 'Blue', hex: '#2563EB' },
  { name: 'Navy', hex: '#1E3A8A' },
  { name: 'Purple', hex: '#7C3AED' },
  { name: 'Magenta', hex: '#C026D3' },
  { name: 'Pink', hex: '#F472B6' },
  { name: 'Brown', hex: '#8B5E3C' },
  { name: 'Tan', hex: '#D9B382' },
  { name: 'Light Gray', hex: '#D4D4D8' },
  { name: 'Dark Gray', hex: '#52525B' },
  { name: 'Black', hex: '#18181B' },
];

export const PALETTE_SETS = {
  crayola: { label: 'Crayola 24', colors: CRAYOLA_24 },
  vivid: { label: 'Vivid 24', colors: VIVID_24 },
} as const;

export type PaletteSetId = keyof typeof PALETTE_SETS;

export const prepare = (colors: PaletteColor[]): PreparedColor[] =>
  colors.map((c) => ({ ...c, rgb: hexToRgb(c.hex), lab: hexToLab(c.hex) }));
