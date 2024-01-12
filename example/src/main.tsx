import ReactDOM from "react-dom/client";
import dayjs from "dayjs";
import App from "./App.tsx";
import "./index.css";

import localizedFormat from "dayjs/plugin/localizedFormat";
dayjs.extend(localizedFormat);

ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
