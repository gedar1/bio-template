import { cloneElement, type FC, type ReactElement, type SVGProps } from "react";

export type IconProps = Pick<SVGProps<SVGSVGElement>, "width" | "height">;

type IconWrapperProps = IconProps & {
  children: ReactElement<SVGProps<SVGSVGElement>>;
  id?: string;
  elementId?: string;
};

const Icon: FC<IconWrapperProps> = ({ width = 24, height = 24, children }) => {
  return cloneElement(children, {
    width,
    height,
  });
};

export default Icon;
