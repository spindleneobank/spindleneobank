export function CompareTable({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return (
    <div className="spm-table-wrap">
      <table className="spm-table">
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={c || 'row'} scope="col" className={i === 0 ? 'sp-sr-only' : undefined}>
                {i === 0 ? 'Feature' : c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              {r.map((c, i) =>
                i === 0 ? (
                  <th key={`${r[0]}-${c}`} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={`${r[0]}-${columns[i]}`}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
