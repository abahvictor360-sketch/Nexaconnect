import { Route, Switch } from "wouter";
import Index from "./pages/index";
import ProjectorPage from "./pages/projector";
import StreamPage from "./pages/stream";
import StagePage from "./pages/stage";
import RemotePage from "./pages/remote";
import { Provider } from "./components/provider";
import { AgentFeedback } from "@runablehq/website-runtime";

function App() {
  return (
    <Provider>
      <Switch>
        <Route path="/" component={Index} />
        <Route path="/projector" component={ProjectorPage} />
        <Route path="/stream" component={StreamPage} />
        <Route path="/stage" component={StagePage} />
        <Route path="/remote" component={RemotePage} />
      </Switch>
      {/* Do not remove - off by default, activated by parent iframe via postMessage */}
      {import.meta.env.DEV && <AgentFeedback />}
    </Provider>
  );
}

export default App;
