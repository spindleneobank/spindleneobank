import { CTA } from '../CTA';
import './f0n.css';

export function NotFound() {
  return (
    <div className="f0n-notfound">
      <h1>Page not found</h1>
      <p>This route is outside the network. Let’s take you back.</p>
      <CTA to="/">Back to home</CTA>
    </div>
  );
}
