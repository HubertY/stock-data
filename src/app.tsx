import { Dispatch, useEffect, useReducer, useState } from 'preact/hooks'
import './app.css'
import { ReadonlySignal, computed, signal } from "@preact/signals";
import classNames from 'classnames';

class Pile<T> {
  data: Record<string, T> = {};
  make: (key: string) => T;
  *[Symbol.iterator]() {
    for (const x of Object.entries(this.data)) {
      yield x;
    }
  }
  get(key: string) {
    if (!this.data[key]) {
      this.data[key] = this.make(key);
    }
    return this.data[key];
  }
  set(key: string, val: T) {
    this.data[key] = val;
  }
  constructor(make: (key: string) => T) {
    this.make = make;
  }
}

const rowReducer = (state: string[], action: { type: "addNewRows", item: Record<string, string> }) => {
  if (action.type === "addNewRows") {
    return [...new Set([...state, ...Object.keys(action.item)])];
  }
  throw Error("nope");
};

type AppendColAction = { type: "appendCol", item: string };
type DeleteColAction = { type: "deleteCol", index: number };
type SetColAction = { type: "setCols", val: string[] };
type ColAction = AppendColAction | DeleteColAction | SetColAction;
type ColState = string[];
const colReducer = (state: ColState, action: ColAction) => {
  let cols = state;
  if (action.type === "appendCol") {
    if (cols.includes(action.item)) {
      return cols;
    }
    return cols.concat(action.item);
  }
  else if (action.type === "deleteCol") {
    return cols.slice(0, action.index).concat(cols.slice(action.index + 1));
  }
  else if (action.type === "setCols") {
    return action.val;
  }
  throw Error("nope");
};

const selectedCell = signal<[null | string, null | string]>([null, null]);
const shifted = signal(false);

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Shift") {
    shifted.value = true;
  }
  else if (e.key === "Escape") {
    selectedCell.value = [null, null];
  }
});
window.addEventListener("keyup", (e: KeyboardEvent) => {
  if (e.key === "Shift") {
    shifted.value = false;
  }
});


type Mappify<T, X> = { [K in keyof T]: X };
function parse(s: string): number {
  if (s === "...") {
    return NaN;
  }
  if (s.endsWith("%")) {
    return parseFloat(s.slice(0, -1)) / 100;
  }
  if (s.endsWith("M")) {
    return parseFloat(s.slice(0, -1)) * 1000000;
  }
  if (s.endsWith("B")) {
    return parseFloat(s.slice(0, -1)) * 1000000000;
  }
  if (s.endsWith("T")) {
    return parseFloat(s.slice(0, -1)) * 1000000000000;
  }
  // const asDate = Date.parse(s);
  // if (!isNaN(asDate)) {
  //   return asDate;
  // }
  return parseFloat(s);
}

const data = new Pile((ticker) => new Pile((row) => computed(() => {
  const x = modified.get(ticker).get(row).value;
  return x !== "" ? x : truth.get(ticker).get(row).value;
})));
const modified = new Pile(() => new Pile(() => signal("")));
const truth = new Pile(() => new Pile(() => signal("...")));
const requested = new Pile(() => false);

type DerivedPile<T> = Pile<T> & { dependencies: string[] }
function makeDerivedPile<T extends number[]>(fn: (...args: T) => number, deps: Mappify<T, string>) {
  const ffn = (...args: Mappify<T, string>) => {
    const is = args.map(parse);
    return fn(...is as T);
  };
  const ret = new Pile((ticker) => {
    return computed(() => ffn(...deps.map(s => data.get(ticker).get(s).value) as Mappify<T, string>));
  }) as DerivedPile<ReadonlySignal<number>>;
  ret.dependencies = deps;
  return ret;
}


const RISK_FREE_RATE = 0.04; // 30 year treasury rate
const MARKET_RATE = 0.092 // ten-year average return of stock market over 140 years
function CAPM(beta: number) {
  return (RISK_FREE_RATE + beta * (MARKET_RATE - RISK_FREE_RATE));
}

// function capmPrice(beta: number, eps: number, growth: number) {
//   const expectedrate = (RISK_FREE_RATE + beta * (MARKET_RATE - RISK_FREE_RATE));
//   if (growth >= expectedrate) {
//     return Infinity;
//   }
//   const p = (eps * (1 + growth) / (expectedrate - growth));
//   return p;
// }

const DerivedRows = {
  "price (computed)": makeDerivedPile((mcap, shares) => mcap / shares, ["Market Cap (intraday)", "Implied Shares Outstanding 6"]),
  capm: makeDerivedPile(CAPM, ["Beta (5Y Monthly)"]),
  //capmPrice: makeDerivedPile(capmPrice, ["Beta (5Y Monthly)", "EPS (TTM)", "Quarterly Earnings Growth (yoy)"])
} as Record<string, DerivedPile<ReadonlySignal<number>>>;


function tryFetchTicker(tick: string, force = false) {
  requested.set(tick, true);
  const ret = fetch(`/endpoint?ticker=${tick}&nocache=${force}`).then(data => data.json()).then((item: Record<string, string>) => {
    for (const [k, v] of Object.entries(item)) {
      truth.get(tick).get(k).value = v;
    }
    return item;
  })
  ret.catch(() => {
    requested.set(tick, false);
  });
  return ret;
}

function shallowComp<T>(a1: T[], a2: T[]) {
  if (a1.length != a2.length) {
    return false;
  }
  for (let i = a1.length; i--;) {
    if (a1[i] !== a2[i]) {
      return false;
    }
  }
  return true;
}

function ColHeader({ s, i, dispatchCols }: { s: string, i: number, dispatchCols: Dispatch<ColAction> }) {
  return <>
    <th class="clickable" onClick={() => {
      selectedCell.value = [null, s];
    }}>{s} {(shallowComp(selectedCell.value, [null, s]) || shifted.value) && <>
      <button onClick={
        () => {
          tryFetchTicker(s, true);
          for (const [_, v] of truth.get(s)) {
            v.value = "...";
          }
        }
      }>🔄</button>
      <button onClick={(e) => {
        e.stopPropagation();
        dispatchCols({ type: "deleteCol", index: i });
      }}>🗑️</button>
    </>}</th>
  </>
}

function ColTopRow({ cols, dispatchCols }: { cols: string[], dispatchCols: Dispatch<ColAction> }) {
  return <>{cols.map((s, i) => <ColHeader key={s} s={s} i={i} dispatchCols={dispatchCols} />)}</>;
}

function DataCell({ col, row }: { col: string, row: string }) {
  const [srow, scol] = selectedCell.value;
  const valueWasModified = modified.get(col).get(row).value !== "";
  const cellIsSelected = col === scol && row === srow;
  const rowIsDependency = srow && DerivedRows[srow] && DerivedRows[srow].dependencies.includes(row);
  return <td class={classNames("clickable", {
    "selected": cellIsSelected,
    "dependent": rowIsDependency
  })} onClick={() => {
    selectedCell.value = [row, col];
  }}>
    {data.get(col).get(row).value}
    {valueWasModified && <button onClick={(e) => {
      e.stopPropagation();
      modified.get(col).get(row).value = "";
    }}>🚮</button>}
    {!valueWasModified
      && (
        cellIsSelected
        || col === scol && rowIsDependency
        || shifted.value)
      && <button onClick={(e) => {
        e.stopPropagation();
        const s = prompt("choose a new value:");
        s && (modified.get(col).get(row).value = s);
      }}>✍️</button>
    }
  </td >
}

function DerivedDataCell({ col, row }: { col: string, row: string }) {
  const [srow, scol] = selectedCell.value;
  const cellIsSelected = col === scol && row === srow;
  return <td class={classNames("clickable", "derived", { "selected": cellIsSelected })} onClick={() => {
    selectedCell.value = [row, col];
  }}>
    {DerivedRows[row].get(col).value.toFixed(2)}
  </td >
}

function DataTable({ allRows = [] as string[], allCols = [] as string[], saved = {} as Record<string, string[]> }) {
  const [savedGroups, setSavedGroups] = useState(saved);
  const [rows, dispatchRows] = useReducer(rowReducer, allRows);
  const [cols, dispatchCols] = useReducer(colReducer, allCols);
  useEffect(() => {
    localStorage.setItem("saved", JSON.stringify(savedGroups));
  }, [savedGroups]);
  useEffect(() => {
    localStorage.setItem("cols", JSON.stringify(cols));
    for (const col of cols) {
      if (!requested.get(col)) {
        tryFetchTicker(col).then((item) => {
          dispatchRows({ type: "addNewRows", item })
        })
      }
    }
  }, [cols])

  return <>
    {Object.entries(savedGroups).map(([k, v]) => <span key={k}>
      <button onClick={() => {
        dispatchCols({ type: "setCols", val: v });
      }}>{k}</button>
      <button onClick={() => {
        const sav = { ...savedGroups };
        delete sav[k];
        setSavedGroups(sav);
      }}>🗑️</button>
    </span>
    )}
    <table>
      <tr>
        <th></th>
        <ColTopRow cols={cols} dispatchCols={dispatchCols} />
        <th>
          <button onClick={() => {
            const tick = prompt("ticker name?");
            if (tick) {
              dispatchCols({ type: "appendCol", item: tick.trim().toUpperCase() });
            }
          }}>➕</button>
          <button onClick={() => {
            const name = prompt("save group as?");
            if (name) {
              setSavedGroups({ ...savedGroups, [name]: cols });
            }
          }}>💾</button>
        </th>
      </tr>
      {
        Object.keys(DerivedRows).map((k) => (
          <tr key={k}>
            <th>{k}</th>
            {cols.map(col => <DerivedDataCell key={col} col={col} row={k} />)}
          </tr>))
      }
      {rows.map(attr => (
        <tr key={attr}>
          <th>{attr}</th>
          {cols.map(col => <DataCell key={col} col={col} row={attr} />)}
        </tr>
      ))}
    </table>

  </>
}

export function App() {
  const defaultCols = ["META", "AMZN", "AAPL", "MSFT", "GOOG"];
  const _savedCols = localStorage.getItem("cols");
  const savedCols = _savedCols && JSON.parse(_savedCols);
  const _savedSaved = localStorage.getItem("saved");
  const savedSaved = _savedSaved && JSON.parse(_savedSaved);
  return (
    <DataTable allRows={[]} allCols={savedCols ?? defaultCols} saved={savedSaved ?? {}} />
  )
}
