import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles.css";

const root = document.getElementById("root")!;
createRoot(root).render(<App />);
