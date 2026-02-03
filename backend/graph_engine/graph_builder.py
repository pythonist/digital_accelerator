import numpy as np
import traceback
import math
import re
from typing import Dict, List, Tuple, Any

try:
    import networkx as nx
except ImportError:
    print("⚠️ NetworkX not installed. Install with: pip install networkx")
    nx = None

class TransactionGraphBuilder:
    def __init__(self, db_manager):
        self.db_manager = db_manager
        self.graph = None

    def _get_safe(self, obj, keys, default=None):
        for k in keys:
            if k in obj and obj[k] is not None:
                return obj[k]
        return default

    def _parse_amount(self, value):
        """
        Robustly parses amounts from strings like '$1,200.50', '1,000', 'USD 500'.
        """
        if value is None: return 0.0
        if isinstance(value, (int, float)): return float(value)
        
        try:
            clean_val = str(value).replace('$', '').replace(',', '').replace(' ', '')
            clean_val = re.sub(r'[^\d\.-]', '', clean_val)
            return float(clean_val)
        except:
            return 0.0

    def _get_all_tables(self, cursor) -> List[str]:
        try:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
            return [row[0] for row in cursor.fetchall()]
        except:
            return []

    def _score_column_match(self, col_name: str, purpose: str) -> int:
        col = col_name.lower()
        if purpose == 'case_id':
            if col in ['case_id', 'caseid']: return 100
            if 'case' in col: return 70
            if col == 'id': return 50
            return 0
        if purpose == 'source':
            if any(x in col for x in ['source', 'src', 'from', 'sender', 'origin']): return 100
            if any(x in col for x in ['account', 'acct', 'cust']): return 80
            return 0
        if purpose == 'target':
            if any(x in col for x in ['target', 'tgt', 'to', 'receiver', 'bene', 'dest']): return 100
            if any(x in col for x in ['counter', 'cp']): return 90
            return 0
        if purpose == 'amount':
            if any(x in col for x in ['amount', 'amt', 'val', 'vol']): return 100
            return 0
        return 0

    def _auto_detect_best_column(self, columns: List[str], purpose: str, exclude: List[str] = []) -> str:
        best_col = None
        best_score = 0
        for col in columns:
            if col in exclude: continue
            score = self._score_column_match(col, purpose)
            if score > best_score:
                best_score = score
                best_col = col
        return best_col

    # --- NEW: CASE PRIORITIZATION ENGINE ---
    def prioritize_cases(self) -> List[Dict]:
        """
        Scans the database to identify and rank high-risk cases automatically.
        """
        conn = self.db_manager.connect()
        prioritized = []
        try:
            cursor = conn.cursor()
            tables = self._get_all_tables(cursor)
            
            # Find the best table representing 'Cases' or 'Alerts'
            target_table = next((t for t in tables if 'case' in t.lower()), None)
            if not target_table:
                target_table = next((t for t in tables if 'alert' in t.lower()), None)

            if target_table:
                cursor.execute(f'SELECT * FROM "{target_table}" LIMIT 1')
                cols = [d[0] for d in cursor.description]
                case_id_col = self._auto_detect_best_column(cols, 'case_id')
                
                if case_id_col:
                    # Aggregate metrics per case
                    query = f'''
                        SELECT 
                            "{case_id_col}" as id,
                            COUNT(*) as alert_count
                        FROM "{target_table}"
                        GROUP BY "{case_id_col}"
                    '''
                    cursor.execute(query)
                    rows = cursor.fetchall()
                    
                    for r in rows:
                        case_id = r[0]
                        alert_count = r[1]
                        
                        risk_score = min(100, (alert_count * 15)) 
                        
                        reason = f"{alert_count} Alerts Detected"
                        if alert_count > 5: reason = "Critical Alert Density"
                        
                        prioritized.append({
                            "case_id": case_id,
                            "risk_score": risk_score,
                            "alert_count": alert_count,
                            "reason": reason,
                            "status": "New" if risk_score > 50 else "Review"
                        })
            
            # Sort by Risk Score Descending
            prioritized.sort(key=lambda x: x['risk_score'], reverse=True)
            return prioritized[:20] 

        except Exception as e:
            print(f"Prioritization Error: {e}")
            return []
        finally:
            self.db_manager.close_connection(conn)

    # --- FETCH ALERTS (Robust) ---
    def _fetch_alerts_robustly(self, case_id: str) -> List[Dict]:
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            all_tables = self._get_all_tables(cursor)
            
            candidate_tables = [t for t in all_tables if any(x in t.lower() for x in ['alert', 'trans', 'suspicious', 'case'])]
            if not candidate_tables: candidate_tables = all_tables

            for table in candidate_tables:
                try:
                    cursor.execute(f'SELECT * FROM "{table}" LIMIT 1')
                    columns = [desc[0] for desc in cursor.description]
                    case_col = self._auto_detect_best_column(columns, 'case_id')
                    if not case_col: continue
                    
                    query = f'SELECT * FROM "{table}" WHERE "{case_col}" = ?'
                    cursor.execute(query, (case_id,))
                    rows = cursor.fetchall()
                    
                    if not rows and str(case_id).isdigit():
                        cursor.execute(query, (int(case_id),))
                        rows = cursor.fetchall()

                    if rows:
                        results = []
                        for r in rows: results.append(dict(zip(columns, r)))
                        return results
                except: continue
            return []
        except: return []
        finally: self.db_manager.close_connection(conn)

    # --- 1. BUILD FULL CASE NETWORK (ENHANCED) ---
    def build_full_case_network(self, case_id: str):
        if not nx: return None
        self.graph = nx.DiGraph()
        
        alerts = self._fetch_alerts_robustly(case_id)
        
        # Base Case Node
        case_node = f"CASE_{case_id}"
        self.graph.add_node(case_node, type='case', label=f"Case {case_id}", risk_score=0, volume=0)

        if not alerts:
            return self.graph

        def get_val(row, candidates):
            for c in candidates:
                for k in row.keys():
                    if c in k.lower() and row[k] is not None: return row[k]
            return None

        for row in alerts:
            # Entity Extraction
            cust_id = get_val(row, ['cust', 'client', 'cif', 'customer'])
            acc_id = get_val(row, ['acct', 'account', 'acc_id', 'account_no'])
            alert_id = get_val(row, ['alert_id', 'id', 'ref']) or 'Unknown'
            cp_id = get_val(row, ['counter', 'bene', 'dest', 'beneficiary'])
            
            # Robust Amount Parsing
            raw_amt = get_val(row, ['amt', 'amount', 'val', 'value'])
            amt = self._parse_amount(raw_amt)
            
            txn_date = get_val(row, ['date', 'time', 'created', 'ts']) or 'Unknown Date'
            txn_ref = get_val(row, ['txn_id', 'trans_id', 'ref']) or f"TXN_{int(amt)}"

            # Customer Node
            if cust_id:
                c_node = f"CUST_{cust_id}"
                if not self.graph.has_node(c_node):
                    self.graph.add_node(c_node, type='customer', label=f"Customer {cust_id}", volume=0)
                    self.graph.add_edge(case_node, c_node, relationship='investigates', width=2)

            # Account Node
            if acc_id:
                a_node = f"ACC_{acc_id}"
                if not self.graph.has_node(a_node):
                    self.graph.add_node(a_node, type='account', label=f"Acct {acc_id}", volume=0)
                
                if cust_id:
                    c_node = f"CUST_{cust_id}"
                    if not self.graph.has_edge(c_node, a_node):
                         self.graph.add_edge(c_node, a_node, relationship='owns', width=2)

            # Alert Node
            al_node = f"ALERT_{alert_id}"
            if not self.graph.has_node(al_node):
                score = get_val(row, ['score', 'risk', 'rating']) or 50
                try: score = float(score)
                except: score = 50
                self.graph.add_node(al_node, type='alert', label=f"Alert {alert_id}", risk_score=score, volume=0)
                if acc_id:
                     self.graph.add_edge(f"ACC_{acc_id}", al_node, relationship='triggered', width=1)

            # Transaction Edge (The money flow)
            if acc_id and cp_id:
                src = f"ACC_{acc_id}"
                cp_node = f"CP_{str(cp_id).replace(' ', '_')}"
                
                if not self.graph.has_node(cp_node):
                    self.graph.add_node(cp_node, type='counterparty', label=str(cp_id), volume=0)

                # Update Node Volumes
                if self.graph.has_node(src): 
                    self.graph.nodes[src]['volume'] = self.graph.nodes[src].get('volume', 0) + amt
                self.graph.nodes[cp_node]['volume'] = self.graph.nodes[cp_node].get('volume', 0) + amt

                # Create or Update Edge
                if self.graph.has_edge(src, cp_node):
                    self.graph[src][cp_node]['volume'] = self.graph[src][cp_node].get('volume', 0) + amt
                    self.graph[src][cp_node]['count'] = self.graph[src][cp_node].get('count', 0) + 1
                    if 'transactions' not in self.graph[src][cp_node]: 
                        self.graph[src][cp_node]['transactions'] = []
                    self.graph[src][cp_node]['transactions'].append({
                        'ref': str(txn_ref), 
                        'date': str(txn_date), 
                        'amount': amt
                    })
                else:
                    self.graph.add_edge(src, cp_node, 
                                      volume=amt, 
                                      count=1, 
                                      relationship='transfer', 
                                      transactions=[{
                                          'ref': str(txn_ref), 
                                          'date': str(txn_date), 
                                          'amount': amt
                                      }])

        self._calculate_node_risk()
        return self.graph

    # --- 2. BUILD CASE GRAPH (Simple) ---
    def build_case_graph(self, case_id: str):
        if not nx: return None
        self.graph = nx.DiGraph()
        alerts = self._fetch_alerts_robustly(case_id)
        
        def get_val(row, candidates):
            for c in candidates:
                for k in row.keys():
                    if c in k.lower() and row[k] is not None: return row[k]
            return None

        for row in alerts:
            src_raw = get_val(row, ['account', 'acct', 'source', 'cust']) or 'Unknown'
            source = f"ACC_{src_raw}"
            tgt_raw = get_val(row, ['counter', 'bene', 'dest']) or 'Unknown'
            target = f"CP_{str(tgt_raw).replace(' ', '_')}"
            
            raw_amt = get_val(row, ['amt', 'amount', 'val'])
            amt = self._parse_amount(raw_amt)

            if not self.graph.has_node(source): self.graph.add_node(source, label=src_raw, type='internal', volume=0)
            if not self.graph.has_node(target): self.graph.add_node(target, label=tgt_raw, type='external', volume=0)

            self.graph.nodes[source]['volume'] = self.graph.nodes[source].get('volume', 0) + amt
            self.graph.nodes[target]['volume'] = self.graph.nodes[target].get('volume', 0) + amt

            if self.graph.has_edge(source, target):
                self.graph[source][target]['volume'] = self.graph[source][target].get('volume', 0) + amt
            else:
                self.graph.add_edge(source, target, volume=amt)
        
        self._calculate_node_risk()
        return self.graph

    # --- 3. BUILD CUSTOM GRAPH ---
    def build_custom_graph(self, table_name, mapping, limit=2000):
        self.graph = nx.DiGraph()
        source_col = mapping.get('source')
        target_col = mapping.get('target')
        amt_col = mapping.get('amount')
        
        if not table_name or not source_col or not target_col: return self.graph

        conn = self.db_manager.connect()
        try:
            cols = f'"{source_col}", "{target_col}"'
            if amt_col: cols += f', "{amt_col}"'
            query = f'SELECT {cols} FROM "{table_name}" LIMIT {limit}'
            cursor = conn.cursor()
            cursor.execute(query)
            rows = cursor.fetchall()
            for row in rows:
                u = str(row[0]).strip() if row[0] else "Unknown"
                v = str(row[1]).strip() if row[1] else "Unknown"
                if u == v: continue
                
                amt = 0.0
                if amt_col and len(row) > 2:
                    amt = self._parse_amount(row[2])
                
                if not self.graph.has_node(u): self.graph.add_node(u, volume=0, type='custom', label=u)
                if not self.graph.has_node(v): self.graph.add_node(v, volume=0, type='custom', label=v)
                
                self.graph.nodes[u]['volume'] = self.graph.nodes[u].get('volume', 0) + amt
                self.graph.nodes[v]['volume'] = self.graph.nodes[v].get('volume', 0) + amt
                self.graph.add_edge(u, v, volume=amt)
        except Exception as e: print(f"Error: {e}")
        finally: self.db_manager.close_connection(conn)
        
        self._calculate_node_risk()
        return self.graph
    
    # --- 4. BUILD ANY GRAPH ---
    def build_graph_from_any_table(self, table_name: str, limit=1000):
        self.graph = nx.DiGraph()
        conn = self.db_manager.connect()
        try:
            cursor = conn.cursor()
            cursor.execute(f'SELECT * FROM "{table_name}" LIMIT 1')
            columns = [d[0] for d in cursor.description]
            
            src = self._auto_detect_best_column(columns, 'source')
            tgt = self._auto_detect_best_column(columns, 'target', exclude=[src] if src else [])
            amt = self._auto_detect_best_column(columns, 'amount')
            
            if src and tgt:
                return self.build_custom_graph(table_name, {'source': src, 'target': tgt, 'amount': amt}, limit)
        except: pass
        finally: self.db_manager.close_connection(conn)
        return self.graph

    # --- SHARED: RISK CALCULATION ---
    def _calculate_node_risk(self):
        if not self.graph: return
        try:
            cycles = list(nx.simple_cycles(self.graph))
            nodes_in_cycles = {n for c in cycles for n in c}
        except:
            nodes_in_cycles = set()

        for n in self.graph.nodes():
            d = self.graph.nodes[n]
            hits = 0
            
            try:
                predecessors = list(self.graph.predecessors(n))
                successors = list(self.graph.successors(n))
                all_neighbors = set(predecessors + successors)
                for neighbor in all_neighbors:
                    if 'ALERT' in str(neighbor): 
                        hits += 1
                    elif self.graph.has_node(neighbor) and self.graph.nodes[neighbor].get('type') == 'alert':
                        hits += 1
            except: pass
            
            vol = d.get('volume', 0)
            is_cycle = 1 if n in nodes_in_cycles else 0
            
            if d.get('type') == 'alert': 
                final = d.get('risk_score', 10)
            else: 
                final = (hits * 10) + (math.log1p(vol) * 3) + (is_cycle * 25)
            
            d['risk_score'] = round(final, 1)
            d['alert_count'] = hits

    # --- ANALYSIS HELPERS ---
    def detect_circular_patterns(self):
        if not self.graph: return []
        try: return list(nx.simple_cycles(self.graph))[:10]
        except: return []

    def find_key_players(self):
        if not self.graph: return []
        try:
            deg = nx.degree_centrality(self.graph)
            return sorted(deg.items(), key=lambda x: x[1], reverse=True)[:5]
        except: return []

    # --- NEW: TYPOLOGY DETECTOR & EVIDENCE GENERATOR ---
    def generate_typology_evidence(self) -> List[Dict]:
        """
        Analyzes the graph structure to generate natural language explanations 
        for why this case was flagged.
        Fixed to safely handle edges without 'volume' (e.g. relationships).
        """
        evidence = []
        if not self.graph: return evidence

        # 1. Flow-Through (Pass-through) Accounts
        for n, d in self.graph.nodes(data=True):
            if d.get('type') == 'account':
                # Use .get('volume', 0) to avoid crashing on relationship edges
                in_vol = sum([self.graph[u][n].get('volume', 0) for u in self.graph.predecessors(n)])
                out_vol = sum([self.graph[n][v].get('volume', 0) for v in self.graph.successors(n)])
                
                if in_vol > 1000 and out_vol > 0:
                    ratio = min(in_vol, out_vol) / max(in_vol, out_vol)
                    if ratio > 0.90:
                        evidence.append({
                            "typology": "Pass-Through Account",
                            "severity": "High",
                            "description": f"Account {d.get('label')} moved ${int(in_vol):,} with {int(ratio*100)}% match between inflow and outflow, suggesting layering."
                        })

        # 2. Fan-Out (Structuring/Dispersal)
        for n, d in self.graph.nodes(data=True):
            successors = list(self.graph.successors(n))
            if len(successors) >= 4:
                # Use .get('volume', 0) here as well
                total_out = sum([self.graph[n][v].get('volume', 0) for v in successors])
                evidence.append({
                    "typology": "Fan-Out Dispersion",
                    "severity": "Medium",
                    "description": f"Entity {d.get('label')} dispersed ${int(total_out):,} to {len(successors)} different recipients."
                })

        # 3. Cycles
        cycles = self.detect_circular_patterns()
        if cycles:
             evidence.append({
                "typology": "Circular Flow",
                "severity": "Critical",
                "description": f"Detected {len(cycles)} circular transaction loops involving {len(cycles[0])} entities."
            })

        return evidence

    def export_graph_data(self):
        if self.graph is None: return {'nodes': [], 'links': [], 'evidence': [], 'metrics': {}}
        
        # Calculate Typologies
        evidence = self.generate_typology_evidence()
        
        nodes = []
        for n, d in self.graph.nodes(data=True):
            score = d.get('risk_score', 0)
            
            # Contextual coloring
            if d.get('type') == 'alert': color = '#ef4444'
            elif d.get('type') == 'case': color = '#8b5cf6'
            elif d.get('type') == 'customer': color = '#10b981'
            elif score >= 50: color = '#dc2626' # Critical
            elif score >= 20: color = '#f97316' # High
            else: color = '#3b82f6' # Normal
            
            size = 5 + (math.log1p(d.get('volume', 0)) * 0.5)
            if d.get('type') == 'case': size = 15

            nodes.append({
                'id': n,
                'label': d.get('label', n),
                'type': d.get('type', 'unknown'),
                'risk_score': score,
                'volume': d.get('volume', 0),
                'alert_count': d.get('alert_count', 0),
                'val': size,
                'color': color
            })
        
        links = []
        for u, v, d in self.graph.edges(data=True):
            tx_count = d.get('count', 0)
            total_vol = d.get('volume', 0)
            
            label = ""
            if tx_count > 0:
                label = f"{tx_count} Txns"
                if total_vol > 0: label += f" | ${int(total_vol/1000)}k"
            elif d.get('relationship'):
                label = d.get('relationship')

            links.append({
                'source': u, 
                'target': v, 
                'width': 1 + math.log1p(total_vol) * 0.2,
                'label': label,
                'volume': total_vol,
                'transactions': d.get('transactions', [])
            })
            
        return {
            'nodes': nodes, 
            'links': links,
            'evidence': evidence,
            'metrics': {
                'total_nodes': len(nodes),
                'total_edges': len(links),
                'max_risk': max([n['risk_score'] for n in nodes]) if nodes else 0
            }
        }