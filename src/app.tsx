import { Dispatch, useEffect, useReducer, useState } from 'preact/hooks'
import './app.css'
import { ReadonlySignal, computed, signal, useSignal } from "@preact/signals";

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
type SelectColAction = { type: "selectCol", index: number };
type SetColAction = { type: "setCols", val: string[] };
type ColAction = AppendColAction | DeleteColAction | SelectColAction | SetColAction;
type ColState = { cols: string[], selectedCols: number };
const colReducer = (state: ColState, action: ColAction) => {
  let { cols, selectedCols } = state;
  if (action.type === "appendCol") {
    return { cols: cols.concat(action.item), selectedCols };
  }
  else if (action.type === "deleteCol") {
    return {
      cols: cols.slice(0, action.index).concat(cols.slice(action.index + 1)), selectedCols: -1
    };
  }
  else if (action.type === "selectCol") {
    return { cols, selectedCols: action.index };
  }
  else if (action.type === "setCols") {
    return { cols: action.val, selectedCols: -1 };
  }
  throw Error("nope");
};

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

const data = new Pile(() => new Pile(() => signal("...")));
const requested = new Pile(() => false);

function makeDerivedPile<T extends number[]>(fn: (...args: T) => number, deps: Mappify<T, string>) {
  const ffn = (...args: Mappify<T, string>) => {
    const is = args.map(parse);
    return fn(...is as T);
  };
  return new Pile((ticker) => {
    return computed(() => ffn(...deps.map(s => data.get(ticker).get(s).value) as Mappify<T, string>));
  });

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
  computedprice: makeDerivedPile((mcap, shares) => mcap / shares, ["Market Cap (intraday)", "Implied Shares Outstanding 6"]),
  capm: makeDerivedPile(CAPM, ["Beta (5Y Monthly)"]),
  //capmPrice: makeDerivedPile(capmPrice, ["Beta (5Y Monthly)", "EPS (TTM)", "Quarterly Earnings Growth (yoy)"])
} as Record<string, Pile<ReadonlySignal<number>>>;


function tryFetchTicker(tick: string, force = false) {
  requested.set(tick, true);
  const ret = fetch(`/endpoint?ticker=${tick}&nocache=${force}`).then(data => data.json()).then((item: Record<string, string>) => {
    for (const [k, v] of Object.entries(item)) {
      data.get(tick).get(k).value = v;
    }
    return item;
  })
  ret.catch(() => {
    requested.set(tick, false);
  });
  return ret;
}

function ColHeader({ s, i, dispatchCols, selected = false }: { s: string, i: number, dispatchCols: Dispatch<ColAction>, selected: boolean }) {
  return <>
    <th onClick={() => {
      dispatchCols({ type: "selectCol", index: i });
    }}>{s} {selected && <>
      <button onClick={
        () => {
          tryFetchTicker(s, true);
          for (const [_, v] of data.get(s)) {
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

function ColTopRow({ cols, selectedCols, dispatchCols }: { cols: string[], selectedCols: number, dispatchCols: Dispatch<ColAction> }) {
  const shifted = useSignal(false);
  useEffect(() => {
    const kdlisten = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shifted.value = true;
      }
    };
    const kulisten = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        shifted.value = false;
      }
    }
    window.addEventListener("keydown", kdlisten);
    window.addEventListener("keyup", kulisten);
    return () => {
      window.removeEventListener("keydown", kdlisten);
      window.removeEventListener("keyup", kulisten);
    }
  }, [shifted]);
  return <>{cols.map((s, i) => <ColHeader key={s} s={s} i={i} selected={shifted.value || selectedCols === i} dispatchCols={dispatchCols} />)}</>;
}

function DataTable({ allRows = [] as string[], allCols = [] as string[], saved = {} as Record<string, string[]> }) {
  const [savedGroups, setSavedGroups] = useState(saved);
  const [rows, dispatchRows] = useReducer(rowReducer, allRows);
  const [{ cols, selectedCols }, dispatchCols] = useReducer(colReducer, { cols: allCols, selectedCols: -1 });
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
        <ColTopRow cols={cols} selectedCols={selectedCols} dispatchCols={dispatchCols} />
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
        Object.entries(DerivedRows).map(([k, v]) => (
          <tr key={k}>
            <th>{k}</th>
            {cols.map(col => <td key={col}>{v.get(col).value.toFixed(2)}</td>)}
          </tr>))
      }
      {rows.map(attr => (
        <tr key={attr}>
          <th>{attr}</th>
          {cols.map(col => <td key={col}>{data.get(col).get(attr).value}</td>)}
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
