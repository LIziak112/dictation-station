import { createRoot } from "react-dom/client";
import { Session } from "./Session";
import "./style.css";
import "./theme.css";

const root = document.getElementById("root");
if (!root) throw new Error("找不到应用挂载点");
createRoot(root).render(<Session />);
