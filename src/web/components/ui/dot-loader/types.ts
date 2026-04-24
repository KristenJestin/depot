export type DotPattern =
  | "wave-diagonal"
  | "wave-diagonal-reverse"
  | "wave-horizontal"
  | "wave-vertical"
  | "pulse"
  | "ripple"
  | "random"
  | "scan-h"
  | "scan-v"
  | "fill"
  | "spinner";

export type DotShape = "circle" | "rounded" | "square";

export type DotLoaderPreset =
  | "thinking"
  | "searching"
  | "analysing"
  | "reading"
  | "debugging"
  | "generating"
  | "soft-spin"
  | "subtle-scan"
  | "terminal";

export interface DotLoaderProps {
  /** Preset qui initialise tous les paramètres. Peut être surchargé par les props suivantes. */
  preset?: DotLoaderPreset;

  rows?: number;
  cols?: number;

  /** Taille d'un point en px. */
  dotSize?: number;
  /** Espacement entre points en px. */
  gap?: number;
  shape?: DotShape;

  /** Couleur CSS du point à pleine intensité (hex, oklch, var(...)). */
  color?: string;
  /** Opacité minimale du point inactif (0–1). Défaut: 0.12 */
  dimOpacity?: number;

  pattern?: DotPattern;
  /**
   * Vitesse perçue du pattern, échelle 1–30.
   * Mappe à animationDuration = round(2600 / speed) ms.
   * Défaut: 16 (~163ms/cycle par point, ~600ms de traversée grille 5×5).
   */
  speed?: number;
  /**
   * Décalage de phase entre deux points adjacents, en ms.
   * Défaut: animationDuration / (rows + cols).
   */
  step?: number;

  /** Texte affiché à droite de la grille. */
  label?: string;

  className?: string;
}
