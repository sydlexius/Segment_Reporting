using System;
using System.IO;
using segment_reporting.Data;
using SharpFuzz;

namespace segment_reporting.Fuzz
{
    // Fuzz the pure security predicates. Property under test: these must return
    // a bool for ANY input and never throw. A crash is a finding. Target is
    // chosen by the first CLI arg (set by run-fuzz.sh per campaign).
    public static class Program
    {
        public static void Main(string[] args)
        {
            string target = args.Length > 0 ? args[0] : "dangerous";

            Fuzzer.OutOfProcess.Run(stream =>
            {
                string input;
                using (var reader = new StreamReader(stream))
                {
                    input = reader.ReadToEnd();
                }

                switch (target)
                {
                    case "dangerous":
                        SegmentRepository.ContainsDangerousKeyword(input);
                        break;
                    case "pragma":
                        SegmentRepository.IsAllowedPragma(input);
                        break;
                    case "marker":
                        // Whitelist lookup must tolerate arbitrary input.
                        MarkerTypes.Valid.Contains(input);
                        break;
                    default:
                        throw new ArgumentException("unknown fuzz target: " + target);
                }
            });
        }
    }
}
