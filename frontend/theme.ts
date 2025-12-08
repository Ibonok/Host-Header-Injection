import { createTheme, MantineColorsTuple } from "@mantine/core";

const teal: MantineColorsTuple = [
  '#f1f4fe',
  '#e4e6ed',
  '#c8cad3',
  '#a9adb9',
  '#9094a3',
  '#7f8496',
  '#777c91',
  '#63687c',
  '#595e72',
  '#4a5167'
];

export const theme = createTheme({
  primaryColor: "teal",
  colors: {
    teal,
  },
  fontFamily: "Inter, var(--mantine-font-family)",
  headings: {
    fontWeight: "600",
  },
  defaultRadius: "md",
});
