import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./globals.css";
import { ColorSchemeScript, MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";

const theme = createTheme({ primaryColor: "dark", defaultRadius: "sm", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", headings: { fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" } });

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><ColorSchemeScript defaultColorScheme="auto" /></head><body><MantineProvider theme={theme} defaultColorScheme="auto"><Notifications position="top-right" />{children}</MantineProvider></body></html>;
}
