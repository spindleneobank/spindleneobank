import { Link } from '@tanstack/react-router';
import { PRIMITIVES, ROLES, type Role } from '../../../content/about';
import { Badge, CommunityCard, RoleLink } from './ui';

export function RolePage({ role }: { role: Role }) {
  return (
    <div className="ab">
      <section className="ab-sec" data-framer-name="Hero Section" style={{ padding: 0 }}>
        <div className="ab-rp-title">
          <div className="ab-rp-c">
            <Link to="/about" hash="career" className="ab-back">
              <span className="ab-mask ab-mask-back" />
              <p>All network roles</p>
            </Link>
            <h1>{role.name}</h1>
            <div className="ab-chips">
              {role.chips.map((c, i) => (
                <div className="ab-chip" key={c}>
                  <span className={`ab-mask ab-mask-chip${i}`} />
                  <p>{c}</p>
                </div>
              ))}
              <div className="ab-chip">
                <span className="ab-mask ab-mask-chip2" />
                <p>Network role • Specification</p>
              </div>
            </div>
          </div>
        </div>
        <div className="ab-rp-body">
          <div className="ab-rp-grid">
            <div className="ab-rp-l">
              <h6>About this network role</h6>
              <p>{role.about}</p>
              <h6>The intended flow</h6>
              <ul>
                {role.flow.map((x) => (
                  <li key={x}>
                    <p>{x}</p>
                  </li>
                ))}
              </ul>
              <h6>Design considerations</h6>
              <ul>
                {role.considerations.map((x) => (
                  <li key={x}>
                    <p>{x}</p>
                  </li>
                ))}
              </ul>
              <h6>Shared network primitives</h6>
              <ul>
                {PRIMITIVES.map((x) => (
                  <li key={x}>
                    <p>{x}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="ab-rp-r">
              <div className="ab-rp-r-in">
                <p>Explore this network role</p>
                <CommunityCard />
              </div>
            </div>
          </div>
        </div>
      </section>
      <section className="ab-sec ab-career" data-framer-name="Career Section">
        <div className="ab-title">
          <div className="ab-title-c is-center">
            <Badge tone="white">Network roles</Badge>
            <h3 className="ab-h2 ab-h3">Explore the network roles</h3>
          </div>
        </div>
        <div className="ab-rl-w">
          <div className="ab-rl">
            {ROLES.map((r) => (
              <RoleLink
                key={r.slug}
                slug={r.slug}
                name={r.name}
                design={r.list.design}
                state={r.list.state}
                category={r.list.category}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
