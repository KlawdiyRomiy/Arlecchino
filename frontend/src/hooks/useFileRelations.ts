import { useRef, useState } from "react";
import * as App from "../../wailsjs/go/main/App";
import {
  dependencyGraphToRelationGroups,
  type RelationGroup,
} from "../utils/perspectiveRelations";

export const useFileRelations = (filePath: string) => {
  const [relations, setRelations] = useState<RelationGroup[]>([]);
  const [prevPath, setPrevPath] = useState("");
  const seqRef = useRef(0);

  if (filePath !== prevPath) {
    setPrevPath(filePath);
    if (filePath) {
      const seq = ++seqRef.current;
      App.GetDependencyGraph(filePath, 2)
        .then((result) => {
          if (seqRef.current === seq) {
            setRelations(dependencyGraphToRelationGroups(result, filePath));
          }
        })
        .catch(() => {
          if (seqRef.current === seq) {
            setRelations([]);
          }
        });
    } else {
      ++seqRef.current;
      setRelations([]);
    }
  }

  return relations;
};
