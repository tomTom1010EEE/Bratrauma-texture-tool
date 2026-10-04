import React from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./styles.css";
import App from "./App";
const theme = createTheme({
  primaryColor: "teal",
  fontFamily: "Inter, Segoe UI, Microsoft YaHei, sans-serif",
  fontFamilyMonospace: "Consolas, monospace",
  defaultRadius: "sm",
  fontSizes: { xs: "12px", sm: "13px", md: "14px", lg: "16px", xl: "20px" },
  colors: {
    dark: [
      "#d5e0ec",
      "#b6c1cf",
      "#8493a6",
      "#627084",
      "#344152",
      "#253041",
      "#1c2430",
      "#161e28",
      "#111720",
      "#0c1118",
    ],
  },
  components: {
    Button: { defaultProps: { fw: 550 } },
    Input: { styles: { input: { borderColor: "#303d4d" } } },
  },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="bottom-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
