import plainUrl from "../assets/logo.svg";
import fullUrl from "../assets/logo-full.svg";

/**
 * The app mark: a teal wallet on a deep-green tile. Same artwork as the favicon and home-screen icons.
 * "full" adds the speed lines, which only read at 64px and up (login page); small sizes use the plain wallet.
 */
export function Logo({ className, full = false }: { className?: string; full?: boolean }) {
  return <img className={className ? `logo ${className}` : "logo"} src={full ? fullUrl : plainUrl} alt="" aria-hidden="true" />;
}
