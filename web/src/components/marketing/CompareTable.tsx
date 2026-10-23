export type CompareGroup = { title: string; rows: string[][] };

/** Compare table. Pass `groups` for the old site's grouped rows (section heading, then rows), or flat `rows`. */
export function CompareTable({
  columns,
  rows,
  groups,
}: {
  columns: string[];
  rows?: string[][];
  groups?: CompareGroup[];
}) {
  const sections: CompareGroup[] = groups ?? [{ title: '', rows: rows ?? [] }];
  return (
    <div className="spm-table-wrap" data-grouped={groups ? 'yes' : undefined}>
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
        {sections.map((g) => (
          <tbody key={g.title || 'rows'}>
            {g.title ? (
              <tr className="spm-table-group">
                <th scope="colgroup" colSpan={columns.length}>
                  {g.title}
                </th>
              </tr>
            ) : null}
            {g.rows.map((r) => (
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
        ))}
      </table>
    </div>
  );
}
