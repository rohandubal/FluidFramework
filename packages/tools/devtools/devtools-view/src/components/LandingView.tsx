/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

import React from "react";

/**
 * Landing page for the debugger
 */
export function LandingView(): React.ReactElement {
	return (
		<div style={{ marginLeft: "5px" }}>
			<h3>Welcome to the Fluid Framework Developer Tools!</h3>
			<p>To start, select an option from the menu on the left.</p>
			<p>
				The <b>Containers</b> section shows a list of the Fluid containers that have been
				loaded in your application. Click on any of them to see more details about that
				container.
			</p>
			<p>
				The <b>Telemetry</b> section let you look at the telemetry events being generated by
				the Fluid Framework. This includes messages coming from every container, and
				messages coming from sources outside the context of any given container.
			</p>
			{/* <p>For more information, go to [TBD: docs page].</p> */}
		</div>
	);
}
