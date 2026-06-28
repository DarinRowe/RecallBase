import { createRoot } from "react-dom/client";
import { RecallBaseApp } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<RecallBaseApp />);
