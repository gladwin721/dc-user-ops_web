import { BOOKING_STATUSES, type BookingStatus } from "@/lib/conversations.functions";

export const STATUS_META: Record<
  BookingStatus,
  { label: string; badgeClass: string; dotClass: string; calendarClass: string }
> = {
  new: {
    label: "New",
    badgeClass: "bg-muted text-muted-foreground border-transparent",
    dotClass: "bg-muted-foreground",
    calendarClass: "bg-gray-100 text-gray-800 border-gray-300 dark:bg-gray-500/20 dark:text-gray-200 dark:border-gray-500/40",
  },
  booking_pending: {
    label: "Booking Pending",
    badgeClass: "bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30",
    dotClass: "bg-orange-500",
    calendarClass: "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-500/20 dark:text-orange-200 dark:border-orange-500/40",
  },
  payment_pending: {
    label: "Payment Pending",
    badgeClass: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
    dotClass: "bg-amber-500",
    calendarClass: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-500/40",
  },
  cook_job_enquiry: {
    label: "Cook Job Enquiry",
    badgeClass: "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-500/15 dark:text-teal-300 dark:border-teal-500/30",
    dotClass: "bg-teal-500",
    calendarClass: "bg-teal-100 text-teal-900 border-teal-300 dark:bg-teal-500/20 dark:text-teal-200 dark:border-teal-500/40",
  },
  cooking_confirmed: {
    label: "Cooking Confirmed",
    badgeClass: "bg-green-100 text-green-800 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
    dotClass: "bg-green-500",
    calendarClass: "bg-green-100 text-green-900 border-green-300 dark:bg-green-500/20 dark:text-green-200 dark:border-green-500/40",
  },
  completed: {
    label: "Completed",
    badgeClass: "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
    dotClass: "bg-blue-500",
    calendarClass: "bg-blue-100 text-blue-900 border-blue-300 dark:bg-blue-500/20 dark:text-blue-200 dark:border-blue-500/40",
  },
  cancelled: {
    label: "Cancelled",
    badgeClass: "bg-red-100 text-red-800 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
    dotClass: "bg-red-500",
    calendarClass: "bg-red-100 text-red-900 border-red-300 dark:bg-red-500/20 dark:text-red-200 dark:border-red-500/40",
  },
  repeat_booking: {
    label: "Repeat Booking",
    badgeClass: "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-500/30",
    dotClass: "bg-purple-500",
    calendarClass: "bg-purple-100 text-purple-900 border-purple-300 dark:bg-purple-500/20 dark:text-purple-200 dark:border-purple-500/40",
  },
};

export function isBookingStatus(v: string | null | undefined): v is BookingStatus {
  return !!v && (BOOKING_STATUSES as readonly string[]).includes(v);
}

export function statusLabel(v: string | null | undefined): string {
  return isBookingStatus(v) ? STATUS_META[v].label : v ?? "—";
}
