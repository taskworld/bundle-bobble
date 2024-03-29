import React, { useEffect, useState, useCallback } from "react";
import ReactDOM from "react-dom";
import { useObserver, Observer } from "mobx-react-lite";
import "./styles.css";
import { db } from "./db";
import { log, logElementRef } from "./logging";
import { data, loadData } from "./data";
import { ErrorBoundary } from "react-error-boundary";
import { Link, Router } from "@reach/router";
import {
  isCut,
  toggleCut,
  setGraph,
  getReachableModuleCount,
  getReachableSize,
  getReachableCount,
  getRecomputedCount,
  calculateReachability,
  calculateReachableSize
} from "./reachability";
import uiState from "./ui-state";
import formatSize from "bytes";
import { observable } from "mobx";
import { useComputationallyIntensiveValue } from "./queuedRenders";

function App() {
  const form = React.useRef();
  const statsJson = useObserver(() => data.get());
  React.useEffect(() => {
    log("Hello!");
    if (data.get() === null) loadData();
    else log("Data has already been loaded");
  }, []);
  return (
    <div>
      <div className="jumbotron">
        <div className="container-fluid">
          <h1 className="display-3">Bundle Bobble</h1>
          <p>
            This is a little utility that will help you find an effective
            code-splitting point. Useful for large projects.
          </p>
        </div>
      </div>
      <div className="container-fluid p-5">
        <h2>Select webpack stats JSON file</h2>
        <form
          className="mb-5"
          ref={form}
          onSubmit={async e => {
            e.preventDefault();
            const file = form.current.file.files[0];
            log(`Saving file ${file.name} to IndexedDB`);
            try {
              await db.kv.put({
                key: "stats",
                file: file,
                name: file.name,
                time: Date.now()
              });
              log("Saved file to IndexedDB. Loading it...");
              loadData();
            } catch (e) {
              log("Error: " + e);
            }
          }}
        >
          <p>
            <input type="file" name="file" />
          </p>
          <p>
            <input type="submit" />
          </p>
        </form>
        <h2>Analyzer</h2>
        <div className="mb-5">
          {statsJson ? (
            <ErrorBoundary FallbackComponent={MyFallbackComponent}>
              <p>Built at: {new Date(statsJson.builtAt).toString()}</p>
              <Analyzer stats={statsJson} />
            </ErrorBoundary>
          ) : (
            <p>No stats loaded</p>
          )}
        </div>
        <h2>Logs</h2>
        <pre ref={logElementRef} />
      </div>
    </div>
  );
}

const MyFallbackComponent = ({ error }) => (
  <div className="alert alert-danger" role="alert">
    <p>
      <strong>Oops! An error occured!</strong>
    </p>
    <p className="mb-0">
      <strong>Error:</strong> {String(error)}
    </p>
  </div>
);

function Analyzer({ stats }) {
  return (
    <Router>
      <Bobble path="/chunkgroups/*" stats={stats} />
      <Home path="/" stats={stats} />
    </Router>
  );
}

function Home({ stats }) {
  const [choices] = useState(() => observable.set());
  return (
    <div>
      <h3>Which chunks to bobble?</h3>
      {Object.keys(stats.namedChunkGroups).map(key => {
        const id = `check${key}`;
        return (
          <div key={key} className="form-check">
            <Observer>
              {() => (
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={choices.has(key)}
                  onChange={e => {
                    if (e.target.checked) choices.add(key);
                    else choices.delete(key);
                  }}
                  id={id}
                />
              )}
            </Observer>
            <label for={id} className="form-check-label">
              {key}
            </label>
          </div>
        );
      })}
      <Observer>
        {() => (
          <Link
            className="btn btn-primary"
            to={`/chunkgroups/${Array.from(choices).join(",")}`}
            role="button"
          >
            Start Bobblin’!
          </Link>
        )}
      </Observer>
    </div>
  );
}

function Bobble({ stats, "*": rest }) {
  const groupNames = new Set(rest.split(","));
  const groups = Object.keys(stats.namedChunkGroups).filter(k =>
    groupNames.has(k)
  );
  if (!groups.length) return "Not found!";
  const chunkIds = new Set(
    [].concat(...groups.map(k => stats.namedChunkGroups[k].chunks))
  );
  const chunks = stats.chunks.filter(c => chunkIds.has(c.id));
  const moduleIds = new Set(
    [].concat(...chunks.map(c => c.modules.map(m => m.id)))
  );
  const modulesMap = new Map(stats.modules.map(m => [m.id, m]));
  const totalSize = Array.from(moduleIds).reduce(
    (a, id) => a + modulesMap.get(id).size,
    0
  );
  const graph = (window.graph = generateGraph(moduleIds, {
    getParents(id) {
      return modulesMap.get(id).reasons.map(r => r.moduleId);
    },
    getNodeInfo(id) {
      const m = modulesMap.get(id);
      return { name: m.name, size: m.size, stats: m };
    }
  }));
  return (
    <div>
      <h3>Bobble chunk group {[...groupNames].join(", ")}</h3>
      <ul>
        <li>
          IDs of chunks contained in this group: {[...chunkIds].join(", ")}
        </li>
        <li>Number of modules: {moduleIds.size}</li>
        <li>Total size: {formatSize(totalSize)}</li>
      </ul>
      <GraphViewer graph={graph} />
    </div>
  );
}

const onKeyDown = e => {
  if (e.key === "x") {
    if (uiState.focus && uiState.focus.parentId) {
      toggleCut(`${uiState.focus.parentId}=>${uiState.focus.nodeId}`);
    }
  }
  if (e.key === "c") {
    if (uiState.focus) {
      toggleCut(`${uiState.focus.nodeId}`);
    }
  }
};

function GraphViewer({ graph }) {
  useEffect(() => setGraph(graph), [graph]);
  return (
    <div
      className="card"
      style={{ display: "block", minHeight: "100vh" }}
      onKeyDown={onKeyDown}
      tabIndex={0}
    >
      <div
        className="card-header text-right"
        style={{ position: "sticky", top: 0, background: "#eee", zIndex: 1 }}
      >
        <Observer>
          {() => (
            <span>
              {getReachableModuleCount()} reachable, size=
              {formatSize(getReachableSize())}
            </span>
          )}
        </Observer>
      </div>
      <div className="card-body">
        <div className="row">
          <div className="col">
            <Nodes graph={graph} nodeIds={graph.roots} path="" />
          </div>
          <div className="col">
            <div style={{ position: "sticky", top: 64 }}>
              <FocusView graph={graph} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const Nodes = React.memo(function Nodes({ graph, nodeIds, parentId, path }) {
  return (
    <ul>
      {Array.from(nodeIds).map(id => {
        return (
          <li key={id}>
            <Node
              graph={graph}
              nodeId={id}
              parentId={parentId}
              path={path + "=>" + id}
            />
          </li>
        );
      })}
    </ul>
  );
});

const Node = React.memo(function Node({ graph, nodeId, parentId, path }) {
  const shown = useObserver(() => uiState.expanded.get(path));
  const setShown = v => uiState.expanded.set(path, v);
  const node = graph.nodes.get(nodeId);
  const edgeId = parentId ? `${parentId}=>${nodeId}` : null;
  const name = (
    <Observer>
      {() => {
        const count = getReachableCount(nodeId);
        const cut = (parentId && isCut(edgeId)) || isCut(nodeId);
        return (
          <span>
            <span
              className={[
                "name",
                count > 0 ? "-reachable" : "-pruned",
                cut ? "-cut" : "-intact"
              ].join(" ")}
            >
              {node.name}
            </span>{" "}
            [{count}]
            <Impact graph={graph} nodeId={nodeId} />
          </span>
        );
      }}
    </Observer>
  );
  const onFocus = () => (uiState.focus = { nodeId, parentId });
  return (
    <React.Fragment>
      <div
        className="node-item"
        tabIndex={0}
        onFocus={onFocus}
        onClick={() => setShown(!shown)}
        onKeyDown={e => {
          if (e.keyCode === 32) {
            setShown(!shown);
            e.preventDefault();
          }
        }}
      >
        {node.dependencies.size > 0 && (shown ? "[-] " : "[+] ")}
        {name}
      </div>
      {node.dependencies.size > 0 && shown && (
        <Nodes
          graph={graph}
          nodeIds={node.dependencies}
          parentId={nodeId}
          path={path}
        />
      )}
    </React.Fragment>
  );
});

function Impact({ graph, nodeId }) {
  const recomputedCount = useObserver(() => getRecomputedCount());
  const totalReachableSize = useObserver(() => getReachableSize());
  const f = useCallback(
    function calculate() {
      void recomputedCount; // HACK
      const projectedReachabilityMap = calculateReachability(
        graph,
        id => id === nodeId
      );
      const projectedSize = calculateReachableSize(projectedReachabilityMap);
      return { savedSize: totalReachableSize - projectedSize };
    },
    [graph, nodeId, recomputedCount, totalReachableSize]
  );
  const { value: result, source } = useComputationallyIntensiveValue(f);
  if (!result) {
    return null;
  }
  const { savedSize } = result;
  const hue = Math.round(120 * Math.pow(1 - savedSize / totalReachableSize, 5));
  return (
    <span
      style={{ color: `hsl(${hue},80%,40%)`, opacity: source === f ? 1 : 0.5 }}
    >
      {" "}
      +{formatSize(savedSize)}
    </span>
  );
}

function generateGraph(moduleIds, { getNodeInfo, getParents }) {
  const nodes = new Map();
  const roots = new Set(moduleIds);
  for (const id of moduleIds) {
    nodes.set(id, {
      id,
      ...getNodeInfo(id),
      dependencies: new Set(),
      reasons: new Set()
    });
  }
  for (const id of moduleIds) {
    const node = nodes.get(id);
    const parentIds = getParents(id);
    for (const parentId of parentIds) {
      const parent = nodes.get(parentId);
      if (!parent) continue;
      roots.delete(id);
      node.reasons.add(parentId);
      parent.dependencies.add(id);
    }
  }
  return { roots, nodes };
}

function FocusView({ graph }) {
  const focus = useObserver(() => uiState.focus);
  if (!focus) {
    return "Select a module to focus";
  }
  const focusModule = graph.nodes.get(focus.nodeId);
  const focusParent = graph.nodes.get(focus.parentId);
  if (!focusModule) {
    return `Focus module not found: ${focus.nodeId}`;
  }
  return (
    <div>
      <h3>
        {focusParent ? (
          <small className="text-muted">
            {focusParent.name} &rarr;
            <br />
          </small>
        ) : null}
        {focusModule.name}
      </h3>
      <h4>Actions</h4>
      <ul>
        {!!focusParent && (
          <li>
            <kbd>x</kbd> — Delete dependency
          </li>
        )}
        <li>
          <kbd>c</kbd> — Cut module out of the tree
        </li>
      </ul>
      <h4>Reasons</h4>
      <ul>
        {Array.from(focusModule.reasons).map((r, i) => (
          <li key={i}>{graph.nodes.get(r).name}</li>
        ))}
      </ul>
    </div>
  );
}

const rootElement = document.getElementById("root");
ReactDOM.render(<App />, rootElement);
