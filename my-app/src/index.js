// src/index.js
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";            // ⬅️ 이 줄이 있어야 global CSS가 적용돼요
import App from "./App";

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
