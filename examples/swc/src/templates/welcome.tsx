interface Props {
  code: string;
  name: string;
}

export default function Welcome({ name, code }: Props) {
  return (
    <div>
      Hi {name}, thanks for signing up. Your code is {code}
    </div>
  );
}
