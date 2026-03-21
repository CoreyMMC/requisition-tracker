type Props = {
  complete: boolean
}

export default function OrderStatusIcon({ complete }: Props) {
  if (complete) {
    return (
      <span
        title="Complete"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white"
      >
        ✓
      </span>
    )
  }

  return (
    <span
      title="Incomplete"
      className="inline-block h-5 w-5 rounded-sm bg-red-600"
    />
  )
}