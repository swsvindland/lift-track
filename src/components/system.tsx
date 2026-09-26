import type { ComponentProps, ReactElement } from "react";
import { Text as NativeText, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Button, Card, useThemeColor, type ThemeColor } from "heroui-native";
import { twMerge } from "tailwind-merge";

export type IconName = ComponentProps<typeof Ionicons>["name"];

/** Shared native primitives; HeroUI retains control behavior and accessibility. */
export function SystemText({ className, ...props }: ComponentProps<typeof NativeText>) {
  return (
    <NativeText {...props} className={twMerge("font-sans text-base text-foreground", className)} />
  );
}

export function SystemLabel({ className, ...props }: ComponentProps<typeof NativeText>) {
  return (
    <SystemText
      {...props}
      className={twMerge(
        "font-mono text-xs uppercase leading-4 tracking-wider text-muted",
        className
      )}
    />
  );
}

export function SystemValue({ className, ...props }: ComponentProps<typeof NativeText>) {
  return (
    <SystemText
      {...props}
      className={twMerge("font-mono text-5xl leading-tight tabular-nums", className)}
    />
  );
}

/** One icon family keeps compact controls visually consistent. */
export function SystemIcon({
  name,
  size = 20,
  color = "foreground",
}: {
  name: IconName;
  size?: number;
  color?: ThemeColor;
}) {
  const value = useThemeColor(color);
  return <Ionicons name={name} size={size} color={String(value)} />;
}

/** A fixed-size button's label stays on one line, shrinking before it would be cut off. */
const fitted = {
  numberOfLines: 1,
  adjustsFontSizeToFit: true,
  minimumFontScale: 0.7,
  maxFontSizeMultiplier: 1.3,
} as const;

export function SystemButton({
  className,
  variant = "primary",
  icon,
  labelClassName,
  fit = false,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  /** An Ionicons name, or an element for a mark that isn't in the family. */
  icon?: IconName | ReactElement;
  labelClassName?: string;
  fit?: boolean;
}) {
  const iconColor: ThemeColor =
    variant === "primary"
      ? "accent-foreground"
      : variant === "danger-soft"
        ? "danger"
        : "accent-soft-foreground";
  return (
    <Button
      {...props}
      variant={variant}
      className={twMerge(
        "min-h-11 h-auto min-w-11 rounded-2xl px-4 py-3 shadow-none",
        "border border-transparent focus:border-focus",
        variant === "outline" && "border-border",
        variant === "secondary" && "bg-surface-secondary",
        className
      )}
    >
      {(icon || labelClassName || fit) && typeof children === "string" ? (
        <>
          {typeof icon === "string" ? <SystemIcon name={icon} size={18} color={iconColor} /> : icon}
          <Button.Label className={labelClassName} {...(fit ? fitted : {})}>
            {children}
          </Button.Label>
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/**
 * Icon-only button with a 44pt target; the label is required for screen readers. The icon is an
 * Ionicons name, or an element for a mark that isn't in the family.
 */
export function SystemIconButton({
  icon,
  accessibilityLabel,
  variant = "ghost",
  color,
  iconSize = 22,
  className,
  ...props
}: ComponentProps<typeof Button> & {
  icon: IconName | ReactElement;
  accessibilityLabel: string;
  color?: ThemeColor;
  iconSize?: number;
}) {
  return (
    <Button
      {...props}
      isIconOnly
      variant={variant}
      accessibilityLabel={accessibilityLabel}
      className={twMerge(
        "h-11 w-11 min-w-11 rounded-full border border-transparent p-0 shadow-none",
        variant === "secondary" && "bg-surface-secondary",
        className
      )}
    >
      {typeof icon === "string" ? (
        <SystemIcon
          name={icon}
          size={iconSize}
          color={color ?? (variant === "primary" ? "accent-foreground" : "foreground")}
        />
      ) : (
        icon
      )}
    </Button>
  );
}

const width = (value: number, scale: number) =>
  `${Math.max(0, Math.min(100, (value / scale) * 100))}%` as const;

/** A thin neutral progress bar; over the maximum turns amber. */
export function MiniBar({ value, max }: { value: number; max: number }) {
  return (
    <View className="h-1 overflow-hidden rounded-full bg-border">
      <View
        className={twMerge("h-1 rounded-full", value > max ? "bg-warning" : "bg-muted")}
        style={{ width: width(value, Math.max(max, 1)) }}
      />
    </View>
  );
}

function Panel({ className, ...props }: ComponentProps<typeof Card>) {
  return (
    <Card
      {...props}
      className={twMerge("rounded-3xl border-0 bg-surface p-5 shadow-none", className)}
    />
  );
}

export const SystemPanel = Object.assign(Panel, {
  Body: Card.Body,
  Header: Card.Header,
  Footer: Card.Footer,
  Title: Card.Title,
  Description: Card.Description,
});

/** A compact toggle for filters, such as muscles in exercise search. */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onPress={onPress}
      accessibilityState={{ selected }}
      className={twMerge(
        "h-9 min-h-9 rounded-full border px-3",
        selected ? "border-accent-soft bg-accent-soft" : "border-border bg-transparent"
      )}
    >
      <Button.Label
        className={twMerge("text-sm", selected ? "text-accent-soft-foreground" : "text-foreground")}
      >
        {label}
      </Button.Label>
    </Button>
  );
}
