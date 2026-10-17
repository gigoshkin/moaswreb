import { memo } from 'react';
import { SvgXml } from 'react-native-svg';
import { icons } from './icons.generated';
import { color as palette } from './theme';

export type IconName = keyof typeof icons;

interface Props {
  name: IconName;
  /** Defaults to the size the icon was drawn at in Figma. */
  size?: number;
  color?: string;
}

export const Icon = memo(function Icon({ name, size, color = palette.ink }: Props) {
  const icon = icons[name];
  const s = size ?? icon.size;
  return <SvgXml xml={icon.xml} width={s} height={s} color={color} />;
});
