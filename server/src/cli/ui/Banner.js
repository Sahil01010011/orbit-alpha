import React from "react";
import { Box, Text } from "ink";
import { theme } from "./theme.js";

export function Banner() {
  return React.createElement(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: theme.cyan }, "  ██████╗ "),
      React.createElement(Text, { color: theme.blue }, "██████╗ "),
      React.createElement(Text, { color: theme.purple }, "██████╗ "),
      React.createElement(Text, { color: theme.violet }, "██╗████████╗")
    ),
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: theme.cyan }, " ██╔═══██╗"),
      React.createElement(Text, { color: theme.blue }, "██╔══██╗"),
      React.createElement(Text, { color: theme.purple }, "██╔══██╗"),
      React.createElement(Text, { color: theme.violet }, "██║╚══██╔══╝")
    ),
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: theme.cyan }, " ██║   ██║"),
      React.createElement(Text, { color: theme.blue }, "██████╔╝"),
      React.createElement(Text, { color: theme.purple }, "██████╔╝"),
      React.createElement(Text, { color: theme.violet }, "██║   ██║  ")
    ),
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: theme.cyan }, " ██║   ██║"),
      React.createElement(Text, { color: theme.blue }, "██╔══██╗"),
      React.createElement(Text, { color: theme.purple }, "██╔══██╗"),
      React.createElement(Text, { color: theme.violet }, "██║   ██║  ")
    ),
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: theme.cyan }, " ╚██████╔╝"),
      React.createElement(Text, { color: theme.blue }, "██║  ██║"),
      React.createElement(Text, { color: theme.purple }, "██████╔╝"),
      React.createElement(Text, { color: theme.violet }, "██║   ██║  ")
    ),
    React.createElement(
      Box,
      null,
      React.createElement(Text, { color: theme.cyan }, "  ╚═════╝ "),
      React.createElement(Text, { color: theme.blue }, "╚═╝  ╚═╝"),
      React.createElement(Text, { color: theme.purple }, "╚═════╝ "),
      React.createElement(Text, { color: theme.violet }, "╚═╝   ╚═╝  ")
    ),
    React.createElement(
      Text,
      { color: theme.pink },
      "  orbit α · autonomous cli developer agent"
    )
  );
}
