import React from "react";
import { createRoot } from "react-dom/client";
import { CloudPlanGate } from "./CloudPlanGate.jsx";
import "./styles.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <CloudPlanGate />
  </React.StrictMode>,
);
