function ruleBasedAnswer({ question, type, profile }) {
  const q = question.toLowerCase();

  if (type === "yes_no") {
    // Relocation / Location / Work-from-office
    if (q.includes("relocate") || q.includes("location") || q.includes("office") || q.includes("city") || q.includes("commute") || q.includes("stay") || q.includes("reside")) {
      return "Yes, the location is completely fine for me and I am happy to work from the office or relocate/commute as required.";
    }
    // Laptop / Device / Internet / WiFi
    if (q.includes("laptop") || q.includes("device") || q.includes("computer") || q.includes("system") || q.includes("wi fi") || q.includes("wifi") || q.includes("internet")) {
      return "Yes, I have a fully functional laptop and a stable high-speed internet connection ready for work.";
    }
    // Duration / Commitment / Months
    if (q.includes("duration") || q.includes("month") || q.includes("year") || q.includes("time") || q.includes("period") || q.includes("available for")) {
      return "Yes, I am fully available for the required duration and can commit to the schedule without any issues.";
    }
    // Shifts / Night Shift / Weekends / Holidays
    if (q.includes("shift") || q.includes("night") || q.includes("rotation") || q.includes("weekend") || q.includes("holiday") || q.includes("hours")) {
      return "Yes, I am completely comfortable with the shifts and flexible schedule as per the project requirements.";
    }
    // Start Date / Joining / Immediate
    if (q.includes("join") || q.includes("immediate") || q.includes("start")) {
      return "Yes, I am ready to join immediately and start working on the tasks.";
    }
    // Default yes_no answer: complete positive sentence
    return "Yes, I am comfortable with this and fully agree to the terms.";
  }

  /* AVAILABILITY */
  if (type === "availability") {
    return profile.availability || "Immediate";
  }

  /* LOCATION */
  if (type === "location") {
    const loc = profile.location || "";
    // Capitalize first letter
    return loc.charAt(0).toUpperCase() + loc.slice(1) || "Mumbai";
  }

  /* NOTICE PERIOD */
  if (type === "notice_period") {
    return profile.noticePeriodDays ?? 0;
  }

  /* EXPERIENCE */
  if (type === "experience") {
    const exp = profile.experienceYears;
    if (!exp || typeof exp !== 'object') return "0";
    
    if (q.includes("customer")) return exp.customer_support ?? 0;
    if (q.includes("sales")) return exp.sales ?? 0;
    if (q.includes("marketing")) return exp.digital_marketing ?? 0;
    
    const vals = Object.values(exp).filter(v => typeof v === 'number');
    return vals.length > 0 ? Math.max(...vals) : 0;
  }

  /* SALARY */
  if (type === "salary") {
    const sal = profile.expectedSalary;
    if (!sal) return "As per company standards";
    if (q.includes("monthly")) return sal.monthly ?? Math.round((sal.yearly || 0) / 12);
    return sal.yearly ?? 0;
  }

  /* RATING — always pick highest (bot-controlled, never AI) */
  if (type === "rating") {
    if (q.includes("out of 10") || q.includes("/10")) return 9;
    if (q.includes("out of 5") || q.includes("/5")) return 5;
    return 5;
  }

  /* MONTHS OF EXPERIENCE — convert years to months */
  if (type === "months_experience") {
    const exp = profile.experienceYears;
    let years = 0;
    if (exp && typeof exp === 'object') {
      if (q.includes("customer") || q.includes("support")) years = exp.customer_support ?? 0;
      else if (q.includes("sales") || q.includes("business development") || q.includes("bd")) years = exp.sales ?? 0;
      else if (q.includes("marketing") || q.includes("digital")) years = exp.digital_marketing ?? 0;
      else {
        const vals = Object.values(exp).filter(v => typeof v === 'number');
        years = vals.length > 0 ? Math.max(...vals) : 0;
      }
    }
    // Return months — at least 1 month even if years is 0, to avoid failing numeric-required fields
    return Math.max(1, Math.round(years * 12));
  }


  /* JOINING TIME (DAYS) */
  if (type === "joining_days") {
    return profile.noticePeriodDays ?? 0;
  }

  return null; // Let AI handle
}

module.exports = { ruleBasedAnswer };
