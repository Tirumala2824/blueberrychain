import Chat from '@/components/Chat';

// The entire application is one conversation. There is deliberately no
// module navigation, no transaction codes and no per-persona screens:
// a ranch manager, logistics lead, quality manager, finance controller
// and sales lead all type into the same box and all talk to the same
// Supervisor Agent, so they all get the same numbers.
export default function Page() {
  return <Chat />;
}
