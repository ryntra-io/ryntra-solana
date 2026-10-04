import company from "./company.module.css";

/**
 * A company page before its figures: the shapes the page draws — the name,
 * the price, the line, the action — so what arrives fills in rather than
 * jumps in (a skeleton, never a spinner). The catalogue behind the page is
 * usually warm; on a cold instance this is what stands while it is read.
 */
export default function CompanyLoading() {
  return (
    <div className={company.page} aria-busy="true" aria-live="polite" data-surface-state="LOADING">
      <span className={company.lineBone} style={{ width: 88, height: 14 }} />
      <div className={company.top}>
        <div className={company.main}>
          <div className={company.identity}>
            <span className={`${company.logo} ${company.lineBone}`} style={{ width: 48, height: 48 }} />
            <span className={company.lineBone} style={{ width: 160, height: 24 }} />
          </div>
          <span className={company.lineBone} style={{ width: 180, height: 44 }} />
          <span className={company.lineBone} style={{ width: 120, height: 14 }} />
          <div className={company.chart}>
            <span className={company.chartBone} />
          </div>
        </div>
        <div className={company.aside}>
          <span className={company.lineBone} style={{ width: "90%", height: 14 }} />
          <span className={company.lineBone} style={{ width: "50%", height: 14 }} />
          <span className={company.lineBone} style={{ width: "100%", height: 52 }} />
        </div>
      </div>
    </div>
  );
}
